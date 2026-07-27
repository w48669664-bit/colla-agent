import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Colla Agent product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Colla Agent — Codex × Antigravity<\/title>/i);
  assert.match(html, /Colla Agent/);
  assert.match(html, /Codex builds\. Antigravity challenges/);
  assert.match(html, /Start from Codex/);
  assert.match(html, /Antigravity/);
  assert.match(html, /Codex/);
  assert.match(html, /ITERATION GOVERNOR/);
  assert.match(html, /checking allowance/);
  assert.match(html, /no nested Codex/);
  assert.match(html, /OUTPUTS/);
  assert.match(html, /What the current Codex produced/);
  assert.match(html, /value="12"/);
  assert.match(html, /Neon Snake/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("keeps adaptive rounds, host sessions, CLI traces, and artifact controls visible", async () => {
  const [css, page, layout, packageJson, server, skill, cli, launcher] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../broker/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../skills/relay-room-collaboration/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../scripts/relay-room.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/start-glassbox.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /COLLABORATION ROUNDS/);
  assert.match(page, /ROUND ACTIVITY/);
  assert.match(page, /OUTPUTS/);
  assert.match(page, /\[1, 3, 5, 8, 12\]/);
  assert.match(page, /LAUNCH COMMAND/);
  assert.match(page, /PUBLIC ACTIVITY/);
  assert.match(page, /CODEX HANDOFF/);
  assert.match(page, /FILES CHANGED/);
  assert.match(page, /reviewBudget/);
  assert.match(page, /collectRunUsage/);
  assert.match(page, /followedStageRef/);
  assert.match(page, /runningCycleId/);
  assert.match(page, /Start from Codex/);
  assert.match(page, /fitArtifact/);
  assert.match(page, /scrolling="yes"/);
  assert.match(page, /Resume live follow/);
  assert.match(page, /Filter \$\{meta\.name\} activity/);
  assert.match(page, /Open full preview/);
  assert.match(page, /id: "completion"/);
  assert.match(page, /allow-forms allow-modals allow-pointer-lock allow-same-origin allow-scripts/);
  assert.match(page, /artifact-text-preview/);
  assert.match(page, /Preview truncated after/);
  assert.match(page, /\/game\/index\.html/);
  assert.doesNotMatch(page, /fetch\(brokerUrl\(\"\/api\/run/);
  assert.match(page, /\/api\/usage/);
  assert.match(page, /role="progressbar"/);
  assert.doesNotMatch(page, /\/api\/resume-review/);
  assert.match(page, /\/api\/stop/);
  assert.match(css, /terminal-screen/);
  assert.match(css, /activity-entry/);
  assert.match(css, /activity-arrive/);
  assert.match(css, /cycle-rail/);
  assert.match(css, /usage-grid/);
  assert.match(css, /exchange-flow/);
  assert.match(css, /artifact-list/);
  assert.match(css, /\.artifact-frame iframe/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(layout, /Colla Agent/);
  assert.match(server, /\/api\/session\/start/);
  assert.match(server, /\/api\/session\/artifact/);
  assert.match(server, /\/artifact\//);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /Autonomous nested-Codex runs are retired/);
  assert.match(skill, /Never invoke `codex`, `codex exec`/);
  assert.match(skill, /consult review/);
  assert.match(skill, /scripts\/relay-room\.mjs activity/);
  assert.match(cli, /buildPlanPrompt/);
  assert.match(cli, /normalizePublicProgressLine/);
  assert.match(cli, /onHeartbeat/);
  assert.match(cli, /remains active in the read-only review/);
  assert.match(launcher, /reusing broker/);
  assert.match(launcher, /reusing dashboard/);
  assert.match(launcher, /isHealthy/);
  assert.doesNotMatch(cli, /\bcodex exec\b/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
