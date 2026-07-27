import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HostSessionManager,
  normalizeReviewCap,
  recommendedBudget,
} from "../broker/host-session.mjs";
import {
  hasRepeatedMustFix,
  mustFixSignature,
} from "../broker/review-policy.mjs";

test("normalizes review presets and keeps budgets bounded", () => {
  assert.equal(normalizeReviewCap(2), 1);
  assert.equal(normalizeReviewCap(4), 3);
  assert.equal(normalizeReviewCap(7), 8);
  assert.equal(normalizeReviewCap(20), 12);
  assert.equal(recommendedBudget("low", 12), 3);
  assert.equal(recommendedBudget("medium", 12), 5);
  assert.equal(recommendedBudget("high", 12), 8);
  assert.equal(recommendedBudget("high", 5), 5);
});

test("requires three matching must-fix reviews before declaring no progress", () => {
  const first = JSON.stringify({ verdict: "NEEDS_FIX", mustFix: ["P1: validate the invite role"] });
  const sameNextRound = JSON.stringify({ verdict: "NEEDS_FIX", mustFix: ["P1: validate the invite role"] });
  const resolved = JSON.stringify({ verdict: "PASS", mustFix: [] });
  assert.ok(mustFixSignature(first));
  assert.equal(hasRepeatedMustFix([first, sameNextRound], 3), false);
  assert.equal(hasRepeatedMustFix([first, sameNextRound, resolved], 3), false);
  assert.equal(hasRepeatedMustFix([first, sameNextRound, first], 3), true);
});

test("persists a generic host run, events, and interactive artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "relay-room-host-"));
  const projectRoot = path.join(tempRoot, "project");
  const previewRoot = path.join(projectRoot, "dist");
  const emptyPreviewRoot = path.join(projectRoot, "empty-preview");
  const markdownPath = path.join(projectRoot, "deliverable.md");
  await mkdir(previewRoot, { recursive: true });
  await mkdir(emptyPreviewRoot, { recursive: true });
  await writeFile(
    path.join(previewRoot, "index.html"),
    "<!doctype html><title>Non-Snake output</title><h1>Team invitations</h1>",
  );
  await writeFile(markdownPath, "# Readable deliverable\n");

  const manager = new HostSessionManager({
    snapshotFile: path.join(tempRoot, "bus", "snapshot.json"),
  });
  await manager.init();
  const started = await manager.start({
    projectRoot,
    task: "Add team invitations to the settings application.",
    maxReviewRounds: 8,
    preset: "deep",
  });
  assert.equal(started.mode, "host");
  assert.equal(started.project.name, "project");
  assert.equal(started.reviewCap, 8);

  await manager.appendEvent({
    actor: "antigravity",
    stage: "blueprint",
    kind: "output",
    title: "Plan",
    content: "{\"complexity\":{\"level\":\"high\",\"reviewRounds\":7}}",
    status: "complete",
  });
  await manager.appendEvent({
    actor: "codex",
    stage: "implement",
    kind: "progress",
    title: "Inspecting the settings route",
    content: "Reviewed the existing authorization and form validation paths.",
    status: "running",
  });
  const configured = await manager.configure({
    complexity: "high",
    reviewBudget: 7,
  });
  assert.equal(configured.reviewBudget, 7);
  assert.equal(configured.steps.filter((step) => step.id.startsWith("review-")).length, 7);

  const artifact = await manager.registerArtifact({
    artifactPath: "dist",
    title: "Invitation settings",
  });
  assert.equal(artifact.kind, "web");
  assert.equal(artifact.previewUrl, "/artifact/dist/");
  await assert.rejects(
    () => manager.registerArtifact({ artifactPath: "empty-preview" }),
    /must contain an index\.html/,
  );
  const preview = await manager.resolveArtifact("dist/index.html");
  assert.equal(preview.mediaType, "text/html; charset=utf-8");
  assert.match(await readFile(preview.filePath, "utf8"), /Team invitations/);
  const markdownArtifact = await manager.registerArtifact({
    artifactPath: "deliverable.md",
    title: "Readable deliverable",
  });
  assert.equal(markdownArtifact.kind, "text");
  assert.equal(markdownArtifact.mediaType, "text/plain; charset=utf-8");

  const outsidePath = path.join(tempRoot, "outside");
  await writeFile(outsidePath, "outside project");
  await assert.rejects(
    () => manager.registerArtifact({ artifactPath: "../outside" }),
    /inside the active project/,
  );

  const finished = await manager.finish({
    status: "complete",
    stopReason: "pass",
    summary: "Implementation and review passed.",
  });
  assert.equal(finished.status, "complete");
  assert.equal(finished.stages.implement, "complete");
  assert.equal(finished.stages["review-1"], "skipped");
  assert.equal(finished.stages.complete, "complete");
  assert.equal(finished.artifacts.length, 2);
  const trace = JSON.parse(
    await readFile(
      path.join(projectRoot, ".relay-room", "runs", started.runId, "snapshot.json"),
      "utf8",
    ),
  );
  assert.equal(trace.state.task.title, "Add team invitations to the settings application.");
  assert.equal(trace.state.artifacts[0].path, "dist");
  assert.ok(trace.events.some((event) => event.kind === "progress"));
});
