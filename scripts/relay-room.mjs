#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractJsonPayload,
  hasRepeatedMustFix,
} from "../broker/review-policy.mjs";

const RUNTIME_ROOT = path.resolve(import.meta.dirname, "..");
const BROKER_URL = process.env.RELAY_ROOM_BROKER_URL || "http://127.0.0.1:8787";
const DASHBOARD_URL = process.env.RELAY_ROOM_DASHBOARD_URL || "http://127.0.0.1:3000";
const RUNTIME_DIR = path.join(RUNTIME_ROOT, ".agent-bus");
const RUNTIME_FILE = path.join(RUNTIME_DIR, "runtime.json");
const RUNTIME_LOG = path.join(RUNTIME_DIR, "runtime.log");
const AGY_DEFAULT = path.join(os.homedir(), ".local", "bin", "agy");

const { command, options, positionals } = parseArguments(process.argv.slice(2));

try {
  switch (command) {
    case "start":
      await startCommand();
      break;
    case "event":
      await eventCommand();
      break;
    case "activity":
      await activityCommand();
      break;
    case "consult":
      await consultCommand();
      break;
    case "configure":
      await configureCommand();
      break;
    case "artifact":
      await artifactCommand();
      break;
    case "finish":
      await finishCommand();
      break;
    case "stop":
      await stopCommand();
      break;
    case "status":
      print(await requestJson("/api/state"));
      break;
    case "open":
      await openDashboard();
      print({ opened: true, dashboardUrl: DASHBOARD_URL });
      break;
    case "shutdown":
      await shutdownRuntime();
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown Relay Room command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`[relay-room] ${safeError(error)}\n`);
  process.exitCode = 1;
}

async function startCommand() {
  const projectRoot = path.resolve(String(options.project || process.cwd()));
  const task = await readValue({
    direct: options.task,
    file: options["task-file"],
    fallbackToStdin: true,
  });
  if (!task.trim()) {
    throw new Error("Provide the task with --task, --task-file, or stdin.");
  }

  if (!options["no-launch"]) await ensureRuntime();
  const snapshot = await requestJson("/api/session/start", {
    method: "POST",
    body: {
      projectRoot,
      task,
      title: options.title,
      maxReviewRounds: Number(options.rounds || 5),
      preset: options.preset || presetForRounds(options.rounds),
    },
  });
  if (!options["no-open"]) await openDashboard();
  print({
    runId: snapshot.runId,
    project: snapshot.project,
    reviewCap: snapshot.reviewCap,
    dashboardUrl: DASHBOARD_URL,
    traceFile: path.join(projectRoot, ".relay-room", "runs", snapshot.runId, "snapshot.json"),
  });
}

async function eventCommand() {
  const content = await readValue({
    direct: options.content,
    file: options.file,
    fallbackToStdin: true,
  });
  const snapshot = await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: options.actor || "codex",
      stage: options.stage || "implement",
      kind: options.kind || "status",
      title: options.title || "Codex update",
      content,
      raw: options.raw,
      status: options.status,
    },
  });
  print({ recorded: true, eventCount: snapshot.events.length, activeStage: snapshot.activeStage });
}

async function activityCommand() {
  const content = await readValue({
    direct: options.content,
    file: options.file,
    fallbackToStdin: true,
  });
  const snapshot = await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "codex",
      stage: options.stage || "implement",
      kind: "progress",
      title: options.title || "Codex activity",
      content,
      status: options.status,
    },
  });
  print({ recorded: true, eventCount: snapshot.events.length, activeStage: snapshot.activeStage });
}

async function consultCommand() {
  const mode = positionals[0] || options.mode || "review";
  if (!["plan", "review"].includes(mode)) {
    throw new Error("consult mode must be plan or review.");
  }
  const snapshot = await requestJson("/api/state");
  if (snapshot.mode !== "host" || !snapshot.project?.root) {
    throw new Error("Start a Relay Room host session before consulting Antigravity.");
  }
  if (snapshot.stopRequested) {
    throw new Error("A safe stop is pending; no new Antigravity call was created.");
  }

  const round = Math.max(1, Number(options.round || snapshot.completedRounds + 1 || 1));
  const stage = mode === "plan" ? "blueprint" : `review-${round}`;
  const handoff = mode === "review"
    ? await readValue({
      direct: options.handoff,
      file: options["handoff-file"],
      fallbackToStdin: false,
    }) || findLatestCodexHandoff(snapshot.events)
    : "";
  const prompt = mode === "plan"
    ? buildPlanPrompt(snapshot)
    : buildReviewPrompt(snapshot, round, handoff);
  const agy = process.env.AGY_BINARY || AGY_DEFAULT;
  const args = [
    "--agent", options.model || "gemini-3.6-flash-high",
    "--mode", "plan",
    "--sandbox",
    "--dangerously-skip-permissions",
    "--print-timeout", options.timeout || "5m",
    "--print",
    prompt,
  ];

  await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "antigravity",
      stage,
      kind: "status",
      title: mode === "plan" ? "Antigravity is assessing the project" : `Antigravity is reviewing round ${round}`,
      content: "Read-only consultation is running. Explicit output will appear when the CLI responds.",
      status: "running",
    },
  });
  await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "antigravity",
      stage,
      kind: "prompt",
      title: mode === "plan" ? "Planning prompt sent to Antigravity" : `Review prompt sent · round ${round}`,
      content: prompt,
    },
  });
  await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "antigravity",
      stage,
      kind: "command",
      title: "Antigravity CLI launched",
      content: `${agy} ${args.slice(0, -1).join(" ")} <PROMPT SHOWN ABOVE>`,
    },
  });

  let result;
  let streamStep = 0;
  let insideStructuredOutput = false;
  let lastPublicProgressAt = Date.now();
  let streamQueue = Promise.resolve();
  const appendPublicProgress = (content) => {
    if (!content || streamStep >= 80) return;
    lastPublicProgressAt = Date.now();
    streamStep += 1;
    const title = mode === "plan"
      ? `Planning activity · ${String(streamStep).padStart(2, "0")}`
      : `Review ${round} activity · ${String(streamStep).padStart(2, "0")}`;
    streamQueue = streamQueue
      .then(() => requestJson("/api/session/event", {
        method: "POST",
        body: {
          actor: "antigravity",
          stage,
          kind: "progress",
          title,
          content,
        },
      }))
      .catch(() => undefined);
  };
  const recordPublicProgress = (line) => {
    const trimmed = String(line || "").trim();
    if (/^```(?:json)?\s*$/i.test(trimmed)) {
      insideStructuredOutput = !insideStructuredOutput;
      return;
    }
    if (insideStructuredOutput) return;
    const content = normalizePublicProgressLine(line);
    appendPublicProgress(content);
  };
  const recordQuietPulse = (elapsedMs) => {
    if (Date.now() - lastPublicProgressAt < 14_000) return;
    appendPublicProgress(
      `Antigravity remains active in the read-only review (${Math.floor(elapsedMs / 1_000)}s elapsed); waiting for its next public CLI line.`,
    );
  };
  try {
    result = await runProcess(agy, args, {
      cwd: snapshot.project.root,
      timeoutMs: parseDuration(options.timeout || "5m"),
      onStdoutLine: recordPublicProgress,
      onHeartbeat: recordQuietPulse,
    });
  } catch (error) {
    await streamQueue;
    await requestJson("/api/session/event", {
      method: "POST",
      body: {
        actor: "antigravity",
        stage,
        kind: "error",
        title: "Antigravity consultation failed",
        content: safeError(error),
        status: "failed",
      },
    });
    throw error;
  }
  await streamQueue;

  await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "antigravity",
      stage,
      kind: "output",
      title: mode === "plan" ? "Antigravity plan and questions" : `Antigravity review response · round ${round}`,
      content: result.stdout.trim(),
      raw: result.stdout,
      status: "complete",
    },
  });

  const responseFile = await persistResponse(snapshot, mode, round, result.stdout);
  if (mode === "plan") {
    const plan = extractJsonPayload(result.stdout);
    const complexity = ["low", "medium", "high"].includes(plan?.complexity?.level)
      ? plan.complexity.level
      : "medium";
    const reviewBudget = Number(plan?.complexity?.reviewRounds);
    await requestJson("/api/session/configure", {
      method: "POST",
      body: {
        complexity,
        ...(Number.isFinite(reviewBudget) && reviewBudget > 0 ? { reviewBudget } : {}),
      },
    });
  } else {
    await updateCompletedRound(round);
    await checkRepeatedFindings(round, result.stdout);
  }

  if (result.stderr.trim()) {
    await appendFile(responseFile, `\n\n--- STDERR ---\n${result.stderr.trim()}\n`);
  }
  process.stdout.write(result.stdout.trimEnd());
  if (result.stdout && !result.stdout.endsWith("\n")) process.stdout.write("\n");
  process.stderr.write(`[relay-room] response saved to ${responseFile}\n`);
}

async function configureCommand() {
  const snapshot = await requestJson("/api/session/configure", {
    method: "POST",
    body: {
      complexity: options.complexity || "medium",
      reviewBudget: Number(options.rounds || options.budget),
    },
  });
  print({
    complexity: snapshot.complexity,
    reviewBudget: snapshot.reviewBudget,
    reviewCap: snapshot.reviewCap,
  });
}

async function artifactCommand() {
  const artifactPath = options.path || positionals[0];
  if (!artifactPath) throw new Error("Provide an artifact path.");
  const artifact = await requestJson("/api/session/artifact", {
    method: "POST",
    body: {
      artifactPath,
      title: options.title,
      kind: options.kind,
      description: options.description,
    },
  });
  print(artifact);
}

async function finishCommand() {
  const summary = await readValue({
    direct: options.summary,
    file: options["summary-file"],
    fallbackToStdin: true,
  });
  const snapshot = await requestJson("/api/session/finish", {
    method: "POST",
    body: {
      status: options.status || "complete",
      stopReason: options.reason || "pass",
      summary,
    },
  });
  print({
    runId: snapshot.runId,
    status: snapshot.status,
    stopReason: snapshot.stopReason,
    artifacts: snapshot.artifacts,
    dashboardUrl: DASHBOARD_URL,
  });
}

async function stopCommand() {
  const result = await requestJson("/api/stop", { method: "POST", body: {} });
  print(result);
}

async function ensureRuntime() {
  await mkdir(RUNTIME_DIR, { recursive: true });
  const runtime = await readRuntimeFile();
  const nextRuntime = { ...runtime, startedAt: runtime.startedAt || new Date().toISOString() };

  if (!(await isHealthy(`${BROKER_URL}/health`))) {
    nextRuntime.brokerPid = await startDetached(
      process.execPath,
      [path.join(RUNTIME_ROOT, "broker", "server.mjs")],
    );
  }
  if (!(await isHealthy(DASHBOARD_URL))) {
    nextRuntime.uiPid = await startDetached("npm", ["run", "dev"]);
  }
  await writeFile(RUNTIME_FILE, JSON.stringify(nextRuntime, null, 2));
  await waitForUrl(`${BROKER_URL}/health`, 30_000);
  await waitForUrl(DASHBOARD_URL, 30_000);
}

async function startDetached(binary, args) {
  const logFd = openSync(RUNTIME_LOG, "a");
  const child = spawn(binary, args, {
    cwd: RUNTIME_ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, NO_COLOR: "1" },
  });
  closeSync(logFd);
  child.unref();
  await appendFile(
    RUNTIME_LOG,
    `\n[${new Date().toISOString()}] started ${binary} ${args.join(" ")} (pid ${child.pid})\n`,
  );
  return child.pid;
}

async function shutdownRuntime() {
  const runtime = await readRuntimeFile();
  const stopped = [];
  for (const [label, pid] of [["broker", runtime.brokerPid], ["ui", runtime.uiPid]]) {
    if (!Number.isInteger(pid)) continue;
    try {
      process.kill(-pid, "SIGTERM");
      stopped.push({ label, pid });
    } catch {
      // The process already exited.
    }
  }
  await writeFile(RUNTIME_FILE, JSON.stringify({ stoppedAt: new Date().toISOString() }, null, 2));
  print({ stopped });
}

async function openDashboard() {
  if (process.platform === "darwin") {
    const child = spawn("/usr/bin/open", [DASHBOARD_URL], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

async function requestJson(route, { method = "GET", body } = {}) {
  const response = await fetch(`${BROKER_URL}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${method} ${route} failed with ${response.status}.`);
  return payload;
}

async function persistResponse(snapshot, mode, round, content) {
  const responseDir = path.join(
    snapshot.project.root,
    ".relay-room",
    "runs",
    snapshot.runId,
    "responses",
  );
  await mkdir(responseDir, { recursive: true });
  const fileName = mode === "plan"
    ? "01-antigravity-plan.txt"
    : `${String(round + 2).padStart(2, "0")}-antigravity-review-${String(round).padStart(2, "0")}.txt`;
  const filePath = path.join(responseDir, fileName);
  await writeFile(filePath, content);
  return filePath;
}

async function updateCompletedRound(round) {
  const snapshot = await requestJson("/api/state");
  if (!snapshot.project?.root) return;
  await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "system",
      stage: `review-${round}`,
      kind: "status",
      title: `Review round ${round} recorded`,
      content: `Antigravity completed round ${round}. Codex should now answer every finding before another review.`,
    },
  });
}

async function checkRepeatedFindings(round, responseText) {
  if (round < 3) return;
  const snapshot = await requestJson("/api/state");
  const responses = [round - 2, round - 1].map((previousRound) => {
    const previous = snapshot.events
      .filter(
        (event) =>
          event.actor === "antigravity" &&
          event.stage === `review-${previousRound}` &&
          event.kind === "output",
      )
      .at(-1);
    return previous ? previous.raw || previous.content : "";
  });
  responses.push(responseText);
  if (!hasRepeatedMustFix(responses, 3)) return;
  await requestJson("/api/session/event", {
    method: "POST",
    body: {
      actor: "system",
      stage: `review-${round}`,
      kind: "error",
      title: "No-progress guard triggered",
      content: "Three consecutive reviews returned the same must-fix signature. Relay Room will not create another Antigravity call without human judgment.",
    },
  });
  await requestJson("/api/session/finish", {
    method: "POST",
    body: {
      status: "failed",
      stopReason: "no_progress",
      summary: "Repeated must-fix findings require human judgment.",
    },
  });
}

function buildPlanPrompt(snapshot) {
  return [
    "You are Antigravity, the read-only planning and review colleague in Colla Agent.",
    `Project root: ${snapshot.project.root}`,
    `Task: ${snapshot.task.brief}`,
    `Maximum review rounds: ${snapshot.reviewCap}`,
    "Inspect the current project, its instructions, architecture, tests and relevant files.",
    "Do not modify files. Do not invoke Codex, another agent, or any recursive workflow.",
    "Propose a concrete implementation plan, risks, acceptance criteria and verification commands.",
    "Choose complexity.level from low, medium or high and complexity.reviewRounds from 1 up to the stated cap.",
    "Ask Codex focused questions where design judgment is needed.",
    "Return one JSON object with: summary, complexity, plan, risks, acceptance, verification, messageToCodex, questions.",
  ].join("\n");
}

function buildReviewPrompt(snapshot, round, handoff) {
  return [
    `You are Antigravity, Codex's read-only review colleague for round ${round}/${snapshot.reviewBudget || snapshot.reviewCap}.`,
    `Project root: ${snapshot.project.root}`,
    `Task: ${snapshot.task.brief}`,
    "Inspect the current project and verify the implementation against the task, project instructions and available tests.",
    "Do not modify files. Do not invoke Codex, another agent, or any recursive workflow.",
    "Answer Codex's handoff and questions directly. Base every finding on observable file or test evidence.",
    "Use PASS when there is no must-fix issue; otherwise use NEEDS_FIX.",
    "Do not reveal private chain-of-thought. Provide concise rationale, evidence and actionable recommendations.",
    "Return one JSON object with: verdict, summary, messageToCodex, findings, mustFix, questions, praise, recommendedNext.",
    "",
    "=== CODEX HANDOFF ===",
    handoff || "Codex requests an independent review of the current implementation.",
  ].join("\n");
}

function findLatestCodexHandoff(events = []) {
  return events
    .filter((event) => event.actor === "codex" && event.kind === "output")
    .at(-1)?.content || "";
}

function runProcess(binary, args, { cwd, timeoutMs, onStdoutLine, onHeartbeat }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stdoutLineBuffer = "";
    let stderr = "";
    let settled = false;
    const startedAt = Date.now();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (!child.killed) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`Antigravity timed out after ${Math.round(timeoutMs / 1_000)} seconds.`)),
      timeoutMs,
    );
    const heartbeat = setInterval(() => onHeartbeat?.(Date.now() - startedAt), 15_000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutLineBuffer += text;
      let newline = stdoutLineBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutLineBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutLineBuffer = stdoutLineBuffer.slice(newline + 1);
        onStdoutLine?.(line);
        newline = stdoutLineBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (stdoutLineBuffer.trim()) onStdoutLine?.(stdoutLineBuffer);
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(stderr.trim() || `Antigravity exited with code ${code}.`));
    });
  });
}

function normalizePublicProgressLine(value) {
  const line = String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line || line.length < 3) return "";
  if (
    /^(?:```|[{}\[\]],?$)/.test(line) ||
    /^"[^"]+"\s*:/.test(line) ||
    /^[-*]\s*"/.test(line)
  ) {
    return "";
  }
  return line.slice(0, 420);
}

async function readValue({ direct, file, fallbackToStdin }) {
  if (direct !== undefined && direct !== true) return String(direct);
  if (file) return readFile(path.resolve(String(file)), "utf8");
  if (!fallbackToStdin || process.stdin.isTTY) return "";
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function isHealthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return;
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}. See ${RUNTIME_LOG}.`);
}

async function readRuntimeFile() {
  try {
    return JSON.parse(await readFile(RUNTIME_FILE, "utf8"));
  } catch {
    return {};
  }
}

function parseArguments(args) {
  const result = { command: args[0], options: {}, positionals: [] };
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      result.positionals.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split(/=(.*)/s);
    if (inline !== undefined) {
      result.options[rawKey] = inline;
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      result.options[rawKey] = next;
      index += 1;
    } else {
      result.options[rawKey] = true;
    }
  }
  return result;
}

function presetForRounds(rounds) {
  const value = Number(rounds || 5);
  if (value <= 3) return "quick";
  if (value <= 5) return "standard";
  if (value <= 8) return "deep";
  return "maximum";
}

function parseDuration(value) {
  const match = String(value).match(/^(\d+)(ms|s|m)?$/);
  if (!match) return 300_000;
  const amount = Number(match[1]);
  if (match[2] === "ms") return amount;
  if (match[2] === "s") return amount * 1_000;
  return amount * 60_000;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/ya29\.\S+/gi, "[redacted]")
    .slice(0, 500);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Relay Room CLI

Usage:
  relay-room start --project <dir> --task <brief> [--rounds 1|3|5|8|12]
  relay-room consult plan
  relay-room activity --stage implement --title <title> --content <public progress>
  relay-room event --actor codex --stage implement --kind output --title <title> < content.txt
  relay-room consult review --round <n> --handoff-file <file>
  relay-room artifact --path <relative-path> [--title <title>] [--kind <kind>]
  relay-room finish --status complete --reason pass --summary <summary>
  relay-room status | open | stop | shutdown
`);
}
