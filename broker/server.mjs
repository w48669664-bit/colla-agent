import http from "node:http";
import { createReadStream } from "node:fs";
import { HostSessionManager } from "./host-session.mjs";
import { getProviderUsage } from "./provider-usage.mjs";

const PORT = Number(process.env.GLASSBOX_PORT || 8787);
const hostSession = new HostSessionManager();
await hostSession.init();

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, hostSession.hasSession() ? hostSession.snapshot() : idleSnapshot());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/usage") {
      json(response, 200, await getProviderUsage());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/usage/refresh") {
      json(response, 200, await getProviderUsage({ force: true }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/start") {
      if (hostSession.snapshot()?.status === "running") {
        json(response, 409, { error: "A collaboration run is already active." });
        return;
      }
      json(response, 201, await hostSession.start(await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/event") {
      json(response, 201, await hostSession.appendEvent(await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/configure") {
      json(response, 200, await hostSession.configure(await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/artifact") {
      json(response, 201, await hostSession.registerArtifact(await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session/finish") {
      json(response, 200, await hostSession.finish(await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/run") {
      json(response, 410, {
        error: "Autonomous nested-Codex runs are retired. Start Colla Agent from the current Codex session with $relay-room-collaboration.",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resume-review") {
      json(response, 410, {
        error: "Legacy autonomous review resume is retired. Resume through the current Codex host session.",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/stop") {
      if (hostSession.hasSession() && hostSession.snapshot()?.status === "running") {
        const snapshot = await hostSession.requestStop();
        json(response, 202, { accepted: true, stopRequested: true, state: snapshot.status });
        return;
      }
      json(response, 409, { error: "No collaboration run is active." });
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/artifact/")) {
      if (!hostSession.hasSession()) {
        json(response, 404, { error: "No host project is active." });
        return;
      }
      const relativePath = decodeURIComponent(url.pathname.slice("/artifact/".length));
      const artifact = await hostSession.resolveArtifact(relativePath);
      response.writeHead(200, {
        "Content-Type": artifact.mediaType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(artifact.filePath.split("/").at(-1))}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(artifact.filePath).pipe(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, {
        ok: true,
        service: "relay-room-broker",
        mode: hostSession.hasSession() ? "host" : "idle",
      });
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    json(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[colla-agent] broker listening on http://localhost:${PORT}`);
  console.log("[colla-agent] every prompt and output is persisted in .agent-bus/snapshot.json");
});

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function idleSnapshot() {
  return {
    runId: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    activeStage: null,
    complexity: null,
    reviewBudget: null,
    reviewCap: 5,
    completedRounds: 0,
    stopReason: null,
    stopRequested: false,
    stages: {
      blueprint: "pending",
      implement: "pending",
    },
    steps: [],
    artifacts: [],
    events: [],
  };
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
