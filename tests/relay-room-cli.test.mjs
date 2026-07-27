import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "scripts", "relay-room.mjs");
const SERVER = path.join(ROOT, "broker", "server.mjs");

test("CLI drives a non-Snake host run without starting a nested Codex", async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "relay-room-cli-"));
  const projectRoot = path.join(tempRoot, "team-settings");
  const siteRoot = path.join(projectRoot, "site");
  await mkdir(siteRoot, { recursive: true });
  await writeFile(
    path.join(siteRoot, "index.html"),
    "<!doctype html><title>Team settings</title><button>Invite teammate</button>",
  );

  const port = await availablePort();
  const brokerUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GLASSBOX_PORT: String(port),
      RELAY_ROOM_SNAPSHOT_FILE: path.join(tempRoot, "bus", "snapshot.json"),
    },
  });
  context.after(() => {
    if (!server.killed) server.kill("SIGTERM");
  });
  await waitForHealth(`${brokerUrl}/health`);
  const retiredAutonomousRun = await fetch(`${brokerUrl}/api/run`, { method: "POST" });
  assert.equal(retiredAutonomousRun.status, 410);
  assert.match(
    (await retiredAutonomousRun.json()).error,
    /Autonomous nested-Codex runs are retired/,
  );

  const env = {
    ...process.env,
    RELAY_ROOM_BROKER_URL: brokerUrl,
    RELAY_ROOM_DASHBOARD_URL: "http://127.0.0.1:3999",
  };
  const started = JSON.parse(await runCli([
    "start",
    "--project", projectRoot,
    "--task", "Build a team invitation settings page.",
    "--rounds", "8",
    "--no-launch",
    "--no-open",
  ], env));
  assert.equal(started.project.name, "team-settings");
  assert.equal(started.reviewCap, 8);

  await runCli([
    "activity",
    "--stage", "implement",
    "--title", "Inspecting invitation roles",
    "--content", "Reviewed role validation and the current settings route.",
  ], env);
  await runCli([
    "event",
    "--actor", "codex",
    "--stage", "implement",
    "--kind", "output",
    "--status", "complete",
    "--title", "Implementation handoff",
    "--content", "Added the invitation settings page and verified its button.",
  ], env);
  const artifact = JSON.parse(await runCli([
    "artifact",
    "--path", "site",
    "--title", "Team invitation settings",
  ], env));
  assert.equal(artifact.kind, "web");

  const preview = await fetch(`${brokerUrl}${artifact.previewUrl}index.html`);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Invite teammate/);

  const finished = JSON.parse(await runCli([
    "finish",
    "--status", "complete",
    "--reason", "pass",
    "--summary", "Non-Snake host workflow passed.",
  ], env));
  assert.equal(finished.status, "complete");
  assert.equal(finished.artifacts.length, 1);

  const trace = JSON.parse(
    await readFile(path.join(projectRoot, ".relay-room", "runs", started.runId, "snapshot.json"), "utf8"),
  );
  assert.equal(trace.state.mode, "host");
  assert.equal(trace.state.task.brief, "Build a team invitation settings page.");
  assert.ok(
    trace.events.some(
      (event) =>
        event.actor === "codex" &&
        event.kind === "progress" &&
        event.title === "Inspecting invitation roles",
    ),
  );
  assert.equal(
    trace.events.some((event) => /\bcodex exec\b/.test(event.content)),
    false,
  );
});

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `CLI exited with ${code}.`));
    });
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Broker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}
