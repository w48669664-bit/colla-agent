import { spawn } from "node:child_process";
import process from "node:process";

const brokerUrl = process.env.RELAY_ROOM_BROKER_URL ||
  `http://127.0.0.1:${process.env.GLASSBOX_PORT || 8787}`;
const dashboardUrl = process.env.RELAY_ROOM_DASHBOARD_URL || "http://127.0.0.1:3000";
const children = [];

if (await isHealthy(`${brokerUrl}/health`)) {
  console.log(`[colla-agent] reusing broker at ${brokerUrl}`);
} else {
  const broker = spawn(process.execPath, ["broker/server.mjs"], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.push(broker);
  pipe(broker, "BROKER", "\x1b[38;5;121m");
}

if (await isHealthy(dashboardUrl)) {
  console.log(`[colla-agent] reusing dashboard at ${dashboardUrl}`);
} else {
  const ui = spawn("npm", ["run", "dev"], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.push(ui);
  pipe(ui, "UI", "\x1b[38;5;208m");
}

if (children.length === 0) {
  console.log("[colla-agent] services are already running");
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`\n[colla-agent] child exited with code ${code}`);
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function pipe(child, label, color) {
  child.stdout.on("data", (chunk) => process.stdout.write(`${color}[${label}]\x1b[0m ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`${color}[${label}]\x1b[0m ${chunk}`));
}

async function isHealthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 180).unref();
}
