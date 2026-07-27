import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const RUNTIME_ROOT = path.resolve(import.meta.dirname, "..");
const BUS_DIR = path.join(RUNTIME_ROOT, ".agent-bus");
const SNAPSHOT_FILE = path.join(BUS_DIR, "snapshot.json");
const REVIEW_OPTIONS = [1, 3, 5, 8, 12];

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/plain; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".xml", "application/xml; charset=utf-8"],
]);

export class HostSessionManager {
  constructor({
    snapshotFile = process.env.RELAY_ROOM_SNAPSHOT_FILE || SNAPSHOT_FILE,
  } = {}) {
    this.snapshotFile = snapshotFile;
    this.busDir = path.dirname(snapshotFile);
    this.state = null;
    this.events = [];
    this.nextEventId = 1;
  }

  async init() {
    await mkdir(this.busDir, { recursive: true });
    try {
      const stored = JSON.parse(await readFile(this.snapshotFile, "utf8"));
      if (stored?.state?.mode !== "host") return;
      this.state = stored.state;
      this.events = Array.isArray(stored.events) ? stored.events : [];
      this.nextEventId =
        this.events.reduce((largest, event) => Math.max(largest, Number(event.id) || 0), 0) + 1;
      if (this.state.status === "running") {
        this.state.status = "failed";
        this.state.finishedAt = new Date().toISOString();
        this.state.activeStage = null;
        this.state.stopReason = "interrupted";
        await this.appendEvent({
          actor: "system",
          stage: "control",
          kind: "error",
          title: "Host session was interrupted",
          content: "The broker restarted while the host Codex session was active. Resume from the recorded trace.",
        });
      }
    } catch {
      // A missing or non-host snapshot is a valid first-run state.
    }
  }

  hasSession() {
    return this.state?.mode === "host";
  }

  deactivate() {
    this.state = null;
    this.events = [];
    this.nextEventId = 1;
  }

  snapshot() {
    if (!this.state) return null;
    return { ...this.state, events: this.events };
  }

  async start({ projectRoot, task, title, maxReviewRounds = 5, preset = "standard" }) {
    const root = await realpath(path.resolve(projectRoot || ""));
    await access(root, constants.R_OK | constants.W_OK);
    const projectStats = await stat(root);
    if (!projectStats.isDirectory()) throw new Error("Project root must be a directory.");

    const now = new Date();
    const runId = `relay-${now.toISOString().replace(/\D/g, "").slice(0, 14)}`;
    const taskBrief = String(task || "").trim();
    if (!taskBrief) throw new Error("A task brief is required.");
    const reviewCap = normalizeReviewCap(maxReviewRounds);

    this.events = [];
    this.nextEventId = 1;
    this.state = {
      runId,
      mode: "host",
      status: "running",
      startedAt: now.toISOString(),
      finishedAt: null,
      activeStage: "intake",
      complexity: null,
      reviewBudget: null,
      reviewCap,
      reviewPreset: preset,
      completedRounds: 0,
      stopReason: null,
      stopRequested: false,
      project: {
        root,
        name: path.basename(root),
        label: abbreviateProjectPath(root),
      },
      task: {
        title: deriveTaskTitle(String(title || firstLine(taskBrief))),
        brief: taskBrief,
      },
      artifacts: [],
      steps: [
        { id: "blueprint", actor: "antigravity", title: "Plan and assess", status: "pending" },
        { id: "implement", actor: "codex", title: "Implement with host Codex", status: "pending" },
      ],
      stages: {
        intake: "complete",
        blueprint: "pending",
        implement: "pending",
      },
    };
    await this.appendEvent({
      actor: "system",
      stage: "intake",
      kind: "status",
      title: "Relay Room host session started",
      content: `Current Codex remains the implementation owner. Antigravity is read-only. Review cap: ${reviewCap}.`,
    });
    return this.snapshot();
  }

  async appendEvent(event) {
    if (!this.state) throw new Error("No host session is active.");
    const actor = ["system", "antigravity", "codex", "verifier"].includes(event.actor)
      ? event.actor
      : "system";
    const kind = ["status", "progress", "prompt", "command", "output", "test", "error"].includes(event.kind)
      ? event.kind
      : "status";
    const stage = String(event.stage || "control");
    const stageStatus = normalizeStageStatus(event.status);

    if (stageStatus) {
      this.state.stages[stage] = stageStatus;
      const completedReview = stage.match(/^review-(\d+)$/);
      if (stageStatus === "complete" && completedReview) {
        this.state.completedRounds = Math.max(
          this.state.completedRounds || 0,
          Number(completedReview[1]),
        );
      }
      const existingStep = this.state.steps.find((step) => step.id === stage);
      if (existingStep) {
        existingStep.status = stageStatus;
      } else if (!["control", "complete", "intake"].includes(stage)) {
        this.state.steps.push({
          id: stage,
          actor: actor === "antigravity" ? "antigravity" : "codex",
          title: String(event.title || stage),
          status: stageStatus,
        });
      }
      if (stageStatus === "running") this.state.activeStage = stage;
      if (["failed", "complete", "skipped"].includes(stageStatus) && this.state.activeStage === stage) {
        this.state.activeStage = null;
      }
    }

    this.events.push({
      id: this.nextEventId++,
      at: new Date().toISOString(),
      actor,
      stage,
      kind,
      title: String(event.title || "Relay Room event").slice(0, 180),
      content: String(event.content || ""),
      ...(event.raw ? { raw: String(event.raw) } : {}),
    });
    if (this.events.length > 2_000) this.events = this.events.slice(-2_000);
    await this.persist();
    return this.snapshot();
  }

  async configure({ complexity = "medium", reviewBudget }) {
    if (!this.state) throw new Error("No host session is active.");
    const normalizedComplexity = ["low", "medium", "high"].includes(complexity)
      ? complexity
      : "medium";
    const requestedBudget = Number(reviewBudget);
    const budget = Math.max(
      1,
      Math.min(
        this.state.reviewCap,
        Number.isFinite(requestedBudget) && requestedBudget > 0
          ? Math.round(requestedBudget)
          : recommendedBudget(normalizedComplexity, this.state.reviewCap),
      ),
    );
    this.state.complexity = normalizedComplexity;
    this.state.reviewBudget = budget;

    for (let round = 1; round <= budget; round += 1) {
      for (const [prefix, actor, title] of [
        ["review", "antigravity", "Review implementation"],
        ["refine", "codex", "Respond and refine"],
      ]) {
        const id = `${prefix}-${round}`;
        if (!this.state.stages[id]) this.state.stages[id] = "pending";
        if (!this.state.steps.some((step) => step.id === id)) {
          this.state.steps.push({ id, actor, title: `${title} · round ${round}`, round, status: "pending" });
        }
      }
    }
    await this.appendEvent({
      actor: "system",
      stage: "blueprint",
      kind: "status",
      title: "Adaptive review plan configured",
      content: `Antigravity assessed ${normalizedComplexity.toUpperCase()} complexity and scheduled ${budget} review round${budget === 1 ? "" : "s"} within the ${this.state.reviewCap}-round cap.`,
    });
    return this.snapshot();
  }

  async registerArtifact({ artifactPath, title, kind, description }) {
    if (!this.state) throw new Error("No host session is active.");
    const resolved = await this.resolveProjectPath(artifactPath);
    if (resolved.stats.isDirectory()) {
      try {
        const entry = await realpath(path.join(resolved.path, "index.html"));
        const relation = path.relative(this.state.project.root, entry);
        if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error();
        if (!(await stat(entry)).isFile()) throw new Error();
      } catch {
        throw new Error("Web artifact directories must contain an index.html file inside the active project.");
      }
    }
    const relativePath = toPosix(path.relative(this.state.project.root, resolved.path));
    const artifact = {
      id: `artifact-${this.state.artifacts.length + 1}`,
      path: relativePath || ".",
      title: String(title || path.basename(resolved.path) || this.state.project.name).slice(0, 120),
      kind: kind || inferArtifactKind(resolved.path, resolved.stats),
      description: String(description || "").slice(0, 500),
      mediaType: resolved.stats.isDirectory()
        ? "text/html; charset=utf-8"
        : MIME_TYPES.get(path.extname(resolved.path).toLowerCase()) || "application/octet-stream",
      previewUrl: `/artifact/${encodeArtifactPath(relativePath)}${resolved.stats.isDirectory() ? "/" : ""}`,
      addedAt: new Date().toISOString(),
    };
    const existingIndex = this.state.artifacts.findIndex((item) => item.path === artifact.path);
    if (existingIndex >= 0) {
      artifact.id = this.state.artifacts[existingIndex].id;
      this.state.artifacts[existingIndex] = artifact;
    } else {
      this.state.artifacts.push(artifact);
    }
    await this.appendEvent({
      actor: "codex",
      stage: this.state.activeStage || "implement",
      kind: "status",
      title: "Output registered",
      content: `${artifact.title} · ${artifact.path} · ${artifact.kind}`,
    });
    return artifact;
  }

  async finish({ status = "complete", stopReason = "pass", summary = "" }) {
    if (!this.state) throw new Error("No host session is active.");
    const terminalStatus = ["complete", "failed", "stopped"].includes(status) ? status : "complete";
    if (terminalStatus === "complete" && stopReason === "pass") {
      for (const [stage, current] of Object.entries(this.state.stages)) {
        const isFutureRound = /^(?:review|refine)-\d+$/.test(stage) && current === "pending";
        if (isFutureRound) this.state.stages[stage] = "skipped";
        else if (current === "running") this.state.stages[stage] = "complete";
      }
      for (const step of this.state.steps) {
        step.status = this.state.stages[step.id] || step.status;
      }
    }
    this.state.status = terminalStatus;
    this.state.stopReason = stopReason;
    this.state.activeStage = null;
    this.state.finishedAt = new Date().toISOString();
    await this.appendEvent({
      actor: "system",
      stage: "complete",
      kind: terminalStatus === "failed" ? "error" : "status",
      title: terminalStatus === "complete" ? "Collaboration complete" : "Collaboration stopped",
      content: summary || `Relay Room finished with reason: ${stopReason}.`,
      status: terminalStatus === "complete" ? "complete" : "failed",
    });
    return this.snapshot();
  }

  async requestStop() {
    if (!this.state || this.state.status !== "running") {
      throw new Error("No host collaboration run is active.");
    }
    this.state.stopRequested = true;
    this.state.stopReason = "manual";
    await this.appendEvent({
      actor: "system",
      stage: this.state.activeStage || "control",
      kind: "status",
      title: "Safe stop requested",
      content: "The host Codex should finish the current step and create no further Antigravity calls.",
    });
    return this.snapshot();
  }

  async resolveProjectPath(relativePath) {
    if (!this.state) throw new Error("No host session is active.");
    const requested = String(relativePath || ".").replace(/^[/\\]+/, "");
    const resolved = await realpath(path.resolve(this.state.project.root, requested));
    const relation = path.relative(this.state.project.root, resolved);
    if (relation.startsWith("..") || path.isAbsolute(relation)) {
      throw new Error("Artifact path must stay inside the active project.");
    }
    const stats = await stat(resolved);
    return { path: resolved, stats };
  }

  async resolveArtifact(relativePath) {
    const resolved = await this.resolveProjectPath(relativePath);
    let filePath = resolved.path;
    let fileStats = resolved.stats;
    if (fileStats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStats = await stat(filePath);
    }
    if (!fileStats.isFile()) throw new Error("Artifact preview target must be a file.");
    return {
      filePath,
      mediaType: MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    };
  }

  async persist() {
    if (!this.state) return;
    const payload = JSON.stringify({ state: this.state, events: this.events }, null, 2);
    await mkdir(this.busDir, { recursive: true });
    await writeFile(this.snapshotFile, payload);

    const traceDir = path.join(
      this.state.project.root,
      ".relay-room",
      "runs",
      this.state.runId,
    );
    await mkdir(traceDir, { recursive: true });
    await writeFile(path.join(traceDir, "snapshot.json"), payload);
    await mkdir(path.join(traceDir, "responses"), { recursive: true });
    await writeFile(
      path.join(this.state.project.root, ".relay-room", "current.json"),
      JSON.stringify({ runId: this.state.runId, snapshot: path.join(traceDir, "snapshot.json") }, null, 2),
    );
  }
}

export function normalizeReviewCap(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  const rounded = Math.round(numeric);
  return REVIEW_OPTIONS.reduce((closest, option) =>
    Math.abs(option - rounded) < Math.abs(closest - rounded) ? option : closest,
  REVIEW_OPTIONS[0]);
}

export function recommendedBudget(complexity, cap) {
  const suggested = complexity === "high" ? 8 : complexity === "low" ? 3 : 5;
  return Math.max(1, Math.min(normalizeReviewCap(cap), suggested));
}

function normalizeStageStatus(value) {
  return ["pending", "running", "complete", "failed", "skipped"].includes(value)
    ? value
    : null;
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() || "Untitled collaboration";
}

function deriveTaskTitle(value) {
  const firstClause = value.split(/[,，;；。]/)[0].trim();
  if (firstClause.length <= 88) return firstClause;
  const clipped = firstClause.slice(0, 89);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 56 ? boundary : 88).trim()}…`;
}

function abbreviateProjectPath(root) {
  const parts = root.split(path.sep).filter(Boolean);
  return parts.slice(-3).join(" / ");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function encodeArtifactPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function inferArtifactKind(filePath, stats) {
  if (stats.isDirectory()) return "web";
  const extension = path.extname(filePath).toLowerCase();
  const mediaType = MIME_TYPES.get(extension) || "";
  if ([".html", ".htm"].includes(extension)) return "web";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  if (extension === ".pdf") return "pdf";
  if (
    mediaType.startsWith("text/") ||
    ["application/json", "application/xml"].includes(mediaType)
  ) return "text";
  return "file";
}
