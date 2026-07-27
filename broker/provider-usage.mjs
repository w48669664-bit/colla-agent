import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const CODEX_DEFAULT = "/Applications/ChatGPT.app/Contents/Resources/codex";
const AGY_DEFAULT = path.join(os.homedir(), ".local", "bin", "agy");
const ANTIGRAVITY_MODEL_ID = "gemini-3.6-flash-high";
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

let cachedUsage = null;
let cachedAt = 0;
let pendingUsage = null;

export async function getProviderUsage({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedUsage && now - cachedAt < CACHE_TTL_MS) return cachedUsage;
  if (!force && pendingUsage) return pendingUsage;

  pendingUsage = Promise.allSettled([
    readWithRetry(readCodexAllowance),
    readWithRetry(readAntigravityAllowance),
  ]).then(([codexResult, antigravityResult]) => {
    const usage = {
      sampledAt: new Date().toISOString(),
      codex: settledProvider(codexResult, "Codex allowance is unavailable."),
      antigravity: settledProvider(
        antigravityResult,
        "Antigravity allowance is unavailable.",
      ),
    };
    cachedUsage = usage;
    cachedAt = Date.now();
    return usage;
  }).finally(() => {
    pendingUsage = null;
  });

  return pendingUsage;
}

async function readWithRetry(reader) {
  try {
    return await reader();
  } catch {
    return reader();
  }
}

function settledProvider(result, fallbackMessage) {
  if (result.status === "fulfilled") return result.value;
  return {
    status: "unavailable",
    remainingPercent: null,
    error: safeError(result.reason, fallbackMessage),
  };
}

async function readCodexAllowance() {
  const binary = process.env.CODEX_BINARY || CODEX_DEFAULT;
  const response = await readCodexRateLimits(binary);
  const snapshot =
    response?.rateLimitsByLimitId?.codex ||
    response?.rateLimits ||
    null;
  if (!snapshot) throw new Error("Codex returned no rate-limit snapshot.");

  const windows = [
    toCodexWindow(snapshot.primary),
    toCodexWindow(snapshot.secondary),
  ].filter(Boolean);
  const remainingValues = windows.map((window) => window.remainingPercent);
  const remainingPercent = remainingValues.length
    ? Math.min(...remainingValues)
    : snapshot.individualLimit?.remainingPercent ?? null;

  return {
    status: remainingPercent === null ? "unavailable" : "ready",
    source: "Codex app-server",
    planType: snapshot.planType || null,
    remainingPercent,
    windows,
    resetsAt:
      windows.find((window) => window.remainingPercent === remainingPercent)?.resetsAt ||
      snapshot.individualLimit?.resetsAt ||
      null,
  };
}

function readCodexRateLimits(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error("Codex allowance lookup timed out."));
    }, REQUEST_TIMEOUT_MS);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
            child.stdin.write(
              `${JSON.stringify({
                id: 2,
                method: "account/rateLimits/read",
                params: null,
              })}\n`,
            );
          } else if (message.id === 2) {
            if (message.error) {
              finish(new Error(message.error.message || "Codex allowance lookup failed."));
            } else {
              finish(null, message.result);
            }
          }
        } catch {
          // App-server diagnostics are ignored unless the request itself fails.
        }
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled && code !== 0) {
        finish(new Error(stderr.trim() || `Codex app-server exited with code ${code}.`));
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "relay-room", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
      })}\n`,
    );
  });
}

function toCodexWindow(window) {
  if (!window || !Number.isFinite(Number(window.usedPercent))) return null;
  const durationMins = Number(window.windowDurationMins || 0) || null;
  return {
    label: labelWindow(durationMins),
    usedPercent: clampPercent(Number(window.usedPercent)),
    remainingPercent: clampPercent(100 - Number(window.usedPercent)),
    durationMins,
    resetsAt: numberOrNull(window.resetsAt),
  };
}

function labelWindow(durationMins) {
  if (!durationMins) return "Allowance window";
  if (durationMins <= 360) return "5-hour window";
  if (durationMins >= 9_000 && durationMins <= 11_000) return "7-day window";
  if (durationMins % 1_440 === 0) return `${durationMins / 1_440}-day window`;
  if (durationMins % 60 === 0) return `${durationMins / 60}-hour window`;
  return `${durationMins}-minute window`;
}

async function readAntigravityAllowance() {
  let credentials = await readAntigravityCredentials();
  if (new Date(credentials.token.expiry).getTime() <= Date.now() + 60_000) {
    await runAgyCredentialRefresh();
    credentials = await readAntigravityCredentials();
  }

  const authorization = `${credentials.token.token_type || "Bearer"} ${credentials.token.access_token}`;
  const metadata = {
    ideType: "IDE_UNSPECIFIED",
    platform: process.platform === "darwin" && process.arch === "arm64"
      ? "DARWIN_ARM64"
      : "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  };
  const commonHeaders = {
    accept: "application/json",
    authorization,
    "content-type": "application/json",
  };
  const loadResponse = await fetchJsonWithTimeout(
    "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({ metadata, mode: "HEALTH_CHECK" }),
    },
  );
  const project = loadResponse.cloudaicompanionProject;
  const availableCredits = Array.isArray(loadResponse.paidTier?.availableCredits)
    ? loadResponse.paidTier.availableCredits
      .filter((credit) => credit.creditType === "GOOGLE_ONE_AI")
      .reduce((sum, credit) => sum + Number(credit.creditAmount || 0), 0)
    : null;

  const quotaHeaders = {
    ...commonHeaders,
    "client-metadata": JSON.stringify(metadata),
    "user-agent": `antigravity/1.1.1 ${process.platform}/${process.arch}`,
    "x-goog-api-client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  };
  const endpoints = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  ];

  let quotaResponse = null;
  let source = null;
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      quotaResponse = await fetchJsonWithTimeout(endpoint, {
        method: "POST",
        headers: quotaHeaders,
        body: JSON.stringify(project ? { project } : {}),
      });
      source = new URL(endpoint).hostname;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!quotaResponse) throw lastError || new Error("Antigravity quota lookup failed.");

  const models = quotaResponse.models && typeof quotaResponse.models === "object"
    ? quotaResponse.models
    : {};
  const selected =
    models[ANTIGRAVITY_MODEL_ID] ||
    Object.values(models).find((model) => model?.displayName === "Gemini 3.6 Flash (High)");
  const remainingFraction = Number(selected?.quotaInfo?.remainingFraction);
  if (!Number.isFinite(remainingFraction)) {
    throw new Error(`No quota data was returned for ${ANTIGRAVITY_MODEL_ID}.`);
  }

  return {
    status: "ready",
    source,
    modelId: ANTIGRAVITY_MODEL_ID,
    modelName: selected.displayName || "Gemini 3.6 Flash (High)",
    remainingPercent: clampPercent(remainingFraction * 100),
    resetsAt: selected.quotaInfo?.resetTime || null,
    availableCredits,
  };
}

async function readAntigravityCredentials() {
  if (process.platform !== "darwin") {
    throw new Error("Automatic Antigravity allowance lookup currently requires macOS Keychain.");
  }
  const secret = (await runCommand(
    "/usr/bin/security",
    ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"],
    10_000,
  )).trim();
  const separator = secret.indexOf(":");
  if (separator < 0 || secret.slice(0, separator) !== "go-keyring-base64") {
    throw new Error("Unsupported Antigravity credential format.");
  }
  const encoded = secret.slice(separator + 1);
  const decoded = Buffer.from(
    encoded,
    encoded.includes("-") || encoded.includes("_") ? "base64url" : "base64",
  ).toString("utf8");
  const credentials = JSON.parse(decoded);
  if (!credentials?.token?.access_token) {
    throw new Error("Antigravity is not signed in.");
  }
  return credentials;
}

async function runAgyCredentialRefresh() {
  const binary = process.env.AGY_BINARY || AGY_DEFAULT;
  await runCommand(binary, ["models"], 30_000);
}

async function fetchJsonWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function runCommand(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`${path.basename(binary)} timed out.`)),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr.trim() || `${path.basename(binary)} exited with code ${code}.`));
    });
  });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function safeError(error, fallback) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/ya29\.\S+/gi, "[redacted]")
    .slice(0, 240);
}
