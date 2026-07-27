#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

const runtimeRoot = path.resolve(import.meta.dirname, "../../..");
const cli = path.join(runtimeRoot, "scripts", "relay-room.mjs");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  process.stderr.write(`[relay-room-skill] ${error.message}\n`);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code || 0;
});
