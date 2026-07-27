"use client";

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

type AgentEvent = {
  id: number;
  at: string;
  actor: "system" | "antigravity" | "codex" | "verifier";
  stage: string;
  kind: "status" | "progress" | "prompt" | "command" | "output" | "test" | "error";
  title: string;
  content: string;
  raw?: string;
};

type StageStatus = "pending" | "running" | "complete" | "failed" | "skipped";

type BrokerStep = {
  id: string;
  actor: "antigravity" | "codex";
  title: string;
  round?: number;
  status: StageStatus;
};

type ProjectArtifact = {
  id: string;
  path: string;
  title: string;
  kind: "web" | "image" | "video" | "audio" | "pdf" | "text" | "file";
  description?: string;
  mediaType?: string;
  previewUrl: string;
  addedAt?: string;
};

type GlassboxState = {
  runId: string | null;
  mode?: "host";
  status: "idle" | "running" | "complete" | "failed" | "stopped";
  startedAt: string | null;
  finishedAt: string | null;
  activeStage: string | null;
  stages: Record<string, StageStatus>;
  steps?: BrokerStep[];
  complexity?: "low" | "medium" | "high" | null;
  reviewBudget?: number | null;
  reviewCap?: number | null;
  completedRounds?: number;
  stopReason?: "pass" | "review_cap" | "no_progress" | "manual" | "interrupted" | null;
  stopRequested?: boolean;
  reviewPreset?: string;
  project?: {
    root: string;
    name: string;
    label: string;
  };
  task?: {
    title: string;
    brief: string;
  };
  artifacts?: ProjectArtifact[];
  events: AgentEvent[];
};

type AllowanceWindow = {
  label: string;
  remainingPercent: number;
  resetsAt: string | number | null;
};

type ProviderAllowance = {
  status: "ready" | "unavailable";
  remainingPercent: number | null;
  resetsAt?: string | number | null;
  source?: string;
  error?: string;
  planType?: string | null;
  modelName?: string;
  availableCredits?: number | null;
  windows?: AllowanceWindow[];
};

type ProviderUsageSnapshot = {
  sampledAt: string;
  codex: ProviderAllowance;
  antigravity: ProviderAllowance;
};

type TerminalEntry = {
  key: string;
  kind: "prompt" | "command" | "output" | "action" | "progress" | "status" | "test" | "error";
  label: string;
  title?: string;
  text: string;
  at?: string;
};

type Cycle = {
  id: string;
  number: number;
  title: string;
  note: string;
  antigravityStage: string;
  codexStage: string;
  status: StageStatus;
};

const EMPTY_STATE: GlassboxState = {
  runId: null,
  status: "idle",
  startedAt: null,
  finishedAt: null,
  activeStage: null,
  stages: { blueprint: "pending", implement: "pending" },
  events: [],
};

const STATUS_LABEL: Record<StageStatus | GlassboxState["status"], string> = {
  idle: "READY",
  pending: "QUEUED",
  running: "LIVE",
  complete: "DONE",
  failed: "FAILED",
  stopped: "STOPPED",
  skipped: "PASSED",
};

const ACTOR_META = {
  antigravity: {
    name: "Antigravity",
    shell: "agy",
    role: "PLANNER / REVIEWER",
  },
  codex: {
    name: "Current Codex",
    shell: "host",
    role: "BUILDER / OWNER",
  },
};

function formatDuration(start: string | null, finish: string | null, now: number) {
  if (!start) return "00:00";
  const startTime = new Date(start).getTime();
  const endTime = finish ? new Date(finish).getTime() : now || startTime;
  const seconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function stageStatus(state: GlassboxState, stage: string): StageStatus {
  return state.stages[stage] || state.steps?.find((step) => step.id === stage)?.status || "pending";
}

function combineStatus(first: StageStatus, second: StageStatus): StageStatus {
  if (first === "failed" || second === "failed") return "failed";
  if (first === "running" || second === "running") return "running";
  if (
    (first === "complete" || first === "skipped") &&
    (second === "complete" || second === "skipped")
  ) {
    return second === "skipped" ? "skipped" : "complete";
  }
  return "pending";
}

function discoverCycles(state: GlassboxState): Cycle[] {
  const knownStages = new Set([
    ...Object.keys(state.stages),
    ...(state.steps || []).map((step) => step.id),
    ...state.events.map((event) => event.stage),
  ]);
  const cycles: Cycle[] = [
    {
      id: "foundation",
      number: 0,
      title: state.mode === "host" ? "Plan & implement" : "Scope & build",
      note: state.mode === "host" ? "项目理解、方案判断与实现" : "方案判断与首版实现",
      antigravityStage: "blueprint",
      codexStage: "implement",
      status: combineStatus(stageStatus(state, "blueprint"), stageStatus(state, "implement")),
    },
  ];

  const rounds = new Set<number>();
  for (const stage of knownStages) {
    const match = stage.match(/^(?:review|refine)(?:-(\d+))?$/);
    if (match) rounds.add(Number(match[1] || 1));
  }
  const planned = state.reviewBudget || 0;
  for (let round = 1; round <= planned; round += 1) rounds.add(round);

  for (const round of [...rounds].sort((a, b) => a - b)) {
    const reviewStage = knownStages.has(`review-${round}`) ? `review-${round}` : "review";
    const refineStage = knownStages.has(`refine-${round}`) ? `refine-${round}` : "refine";
    cycles.push({
      id: `round-${round}`,
      number: round,
      title: `Review round ${String(round).padStart(2, "0")}`,
      note: "监督、回应与修正",
      antigravityStage: reviewStage,
      codexStage: refineStage,
      status: combineStatus(stageStatus(state, reviewStage), stageStatus(state, refineStage)),
    });
  }

  if (knownStages.has("complete")) {
    cycles.push({
      id: "completion",
      number: Math.max(0, ...rounds) + 1,
      title: "Completion",
      note: "最终结果、停止原因与交付摘要",
      antigravityStage: "complete",
      codexStage: "complete",
      status: stageStatus(state, "complete"),
    });
  }

  return cycles;
}

function cleanCommand(command: string) {
  return command
    .replace(/\/Users\/[^\s]+\/\.local\/bin\/agy/g, "agy")
    .replace(/\/Applications\/ChatGPT\.app\/Contents\/Resources\/codex/g, "codex")
    .replace(/\s<PROMPT SHOWN ABOVE>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTerminalText(text: string) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\uFFFD/g, "")
    .trim();
  const fencedJson = text.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fencedJson || cleaned;
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return cleaned;
  }
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > maxLength * 0.65 ? boundary : maxLength).trim()}…`;
}

function taskHeading(task?: GlassboxState["task"]) {
  if (!task) return "Codex builds. Antigravity challenges. You see everything.";
  const firstClause = task.title.split(/[,，;；。]/)[0].trim();
  return truncateText(firstClause || task.title, 88);
}

function formatEventTime(value?: string) {
  if (!value) return "recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recorded";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatReset(value: string | number | null | undefined) {
  if (!value) return "Reset time unavailable";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset time unavailable";
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}`;
}

function wholePercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function AllowanceMeter({
  allowance,
  loading,
}: {
  allowance?: ProviderAllowance;
  loading: boolean;
}) {
  const percent = wholePercent(allowance?.remainingPercent);
  const ready = allowance?.status === "ready" && percent !== null;
  return (
    <div className={`allowance-meter ${loading ? "is-loading" : ""}`}>
      <div className="allowance-value">
        <strong>{ready ? `${percent}%` : "—"}</strong>
        <span>{loading ? "checking allowance" : ready ? "remaining" : "allowance unavailable"}</span>
      </div>
      <div
        aria-label={ready ? `${percent}% allowance remaining` : "Allowance unavailable"}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={ready ? percent : undefined}
        className="allowance-track"
        role="progressbar"
      >
        <span style={{ width: ready ? `${percent}%` : "0%" }} />
      </div>
      <small>{loading ? "Reading provider account…" : ready ? formatReset(allowance?.resetsAt) : allowance?.error || "Sign in to show account quota."}</small>
    </div>
  );
}

function collectRunUsage(events: AgentEvent[]) {
  const codex = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    turns: 0,
  };

  for (const event of events) {
    if (event.actor !== "codex" || event.kind !== "output") continue;
    try {
      const payload = JSON.parse(event.raw || event.content) as {
        type?: string;
        usage?: {
          input_tokens?: number;
          cached_input_tokens?: number;
          output_tokens?: number;
          reasoning_output_tokens?: number;
        };
      };
      if (payload.type !== "turn.completed" || !payload.usage) continue;
      codex.inputTokens += Number(payload.usage.input_tokens || 0);
      codex.cachedInputTokens += Number(payload.usage.cached_input_tokens || 0);
      codex.outputTokens += Number(payload.usage.output_tokens || 0);
      codex.reasoningTokens += Number(payload.usage.reasoning_output_tokens || 0);
      codex.turns += 1;
    } catch {
      // Human-readable CLI output is intentionally ignored by the usage meter.
    }
  }

  const antigravityCalls = events.filter(
    (event) =>
      event.kind === "command" &&
      /\bagy\b|\/agy\b/.test(cleanCommand(event.content)) &&
      /(?:--print|-p\b)/.test(event.content),
  ).length;

  return { codex, antigravityCalls };
}

function brokerUrl(path: string) {
  const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
  return `http://${host}:8787${path}`;
}

function parseCodexEvent(event: AgentEvent): TerminalEntry[] {
  const source = event.raw || event.content;
  try {
    const payload = JSON.parse(source) as {
      type?: string;
      item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string;
        aggregated_output?: string;
        changes?: Array<{ path?: string; kind?: string }>;
        status?: string;
      };
    };
    const item = payload.item;
    if (!item) return [];

    if (item.type === "agent_message" && item.text) {
      return [{
        key: `${event.id}-message`,
        kind: "output",
        label: "CODEX RESPONSE",
        text: item.text,
      }];
    }
    const isMeaningfulCommand = Boolean(item.command?.trim());
    if (
      item.type === "command_execution" &&
      payload.type === "item.started" &&
      item.command &&
      isMeaningfulCommand
    ) {
      return [{
        key: `${event.id}-command`,
        kind: "command",
        label: "SHELL",
        text: cleanCommand(item.command),
      }];
    }
    if (
      item.type === "command_execution" &&
      payload.type === "item.completed" &&
      isMeaningfulCommand &&
      item.aggregated_output?.trim()
    ) {
      return [{
        key: `${event.id}-result`,
        kind: "output",
        label: "COMMAND OUTPUT",
        text: item.aggregated_output.trim(),
      }];
    }
    if (item.type === "file_change" && payload.type === "item.completed" && item.changes?.length) {
      return [{
        key: `${event.id}-files`,
        kind: "action",
        label: "FILES CHANGED",
        text: item.changes
          .map((change) => `${(change.kind || "update").toUpperCase()}  ${change.path?.split("/").slice(-3).join("/")}`)
          .join("\n"),
      }];
    }
  } catch {
    if (
      source.includes(" WARN ") ||
      source.includes("codex_core_") ||
      source.includes("codex_analytics")
    ) {
      return [];
    }
  }
  return [];
}

function buildSession(
  events: AgentEvent[],
  stage: string,
  actor: "antigravity" | "codex",
): TerminalEntry[] {
  const stageEvents = events.filter((event) => event.stage === stage);
  const visibleEvents = stageEvents.filter((event) =>
    actor === "antigravity"
      ? event.actor === "antigravity"
      : event.actor === "codex" ||
        event.actor === "verifier" ||
        (stage === "complete" && event.actor === "system"),
  );

  return visibleEvents.flatMap((event): TerminalEntry[] => {
    if (actor === "codex" && event.actor === "codex" && event.kind === "output") {
      const parsed = parseCodexEvent(event);
      if (parsed.length) {
        return parsed.map((entry) => ({
          ...entry,
          title: event.title,
          at: event.at,
        }));
      }
    }

    const kind: TerminalEntry["kind"] =
      event.kind === "progress" ? "progress" :
      event.kind === "test" ? "test" :
      event.kind === "status" ? "status" :
      event.kind === "prompt" ? "prompt" :
      event.kind === "command" ? "command" :
      event.kind === "error" ? "error" :
      "output";
    const label =
      event.kind === "progress" ? "PUBLIC ACTIVITY" :
      event.kind === "test" ? "VERIFICATION" :
      event.kind === "status" ? "STATUS" :
      event.kind === "prompt" ? "INPUT PROMPT" :
      event.kind === "command" ? "LAUNCH COMMAND" :
      event.kind === "error" ? "SESSION ERROR" :
      actor === "antigravity" ? "RESPONSE" : "CODEX HANDOFF";
    const rawText = event.raw || event.content;
    const text =
      event.kind === "command" ? cleanCommand(event.content) :
      event.kind === "output" ? cleanTerminalText(rawText) :
      event.content;
    if (!text.trim()) return [];
    return [{
      key: `${event.id}-${event.kind}`,
      kind,
      label,
      title: event.title,
      text,
      at: event.at,
    }];
  });
}

function stageTitle(stage: string, actor: "antigravity" | "codex") {
  if (stage === "blueprint") return "Plan and assess";
  if (stage === "implement") return "Implement the task";
  if (stage.startsWith("review")) return "Inspect implementation";
  if (stage.startsWith("refine")) return "Respond and refine";
  return actor === "antigravity" ? "Review session" : "Build session";
}

function TerminalSession({
  actor,
  stage,
  entries,
  status,
}: {
  actor: "antigravity" | "codex";
  stage: string;
  entries: TerminalEntry[];
  status: StageStatus;
}) {
  const meta = ACTOR_META[actor];
  const screenRef = useRef<HTMLDivElement>(null);
  const pinnedToLatestRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(entries.length);
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState(true);
  const revealedEntries = entries.slice(0, visibleCount);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleEntries = normalizedQuery
    ? revealedEntries.filter((entry) =>
      `${entry.title || ""} ${entry.label} ${entry.text}`.toLocaleLowerCase().includes(normalizedQuery)
    )
    : revealedEntries;
  const latestKey = visibleEntries.at(-1)?.key;

  useEffect(() => {
    if (visibleCount >= entries.length) return;
    const timer = window.setTimeout(
      () => setVisibleCount((current) => Math.min(entries.length, current + 1)),
      status === "running" ? 140 : 90,
    );
    return () => window.clearTimeout(timer);
  }, [entries.length, status, visibleCount]);

  useEffect(() => {
    if (status !== "running" || !pinnedToLatestRef.current || !screenRef.current) return;
    screenRef.current.scrollTo({
      top: screenRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [latestKey, status]);

  const updateFollowMode = () => {
    const screen = screenRef.current;
    if (!screen) return;
    const pinned = screen.scrollHeight - screen.scrollTop - screen.clientHeight <= 28;
    if (pinned === pinnedToLatestRef.current) return;
    pinnedToLatestRef.current = pinned;
    setFollowing(pinned);
  };

  const resumeLiveFollow = () => {
    const screen = screenRef.current;
    if (!screen) return;
    pinnedToLatestRef.current = true;
    setFollowing(true);
    screen.scrollTo({ top: screen.scrollHeight, behavior: "smooth" });
  };

  return (
    <article className={`terminal terminal-${actor}`}>
      <header className="terminal-bar">
        <div>
          <span>{meta.name}</span>
          <small>{meta.role}</small>
        </div>
        <p>{meta.shell} / {stage}</p>
        <b className={`terminal-state state-${status}`}>{STATUS_LABEL[status]}</b>
      </header>
      <div className="terminal-context">
        <span>{stageTitle(stage, actor)}</span>
        <label className="terminal-filter">
          <span className="sr-only">Filter {meta.name} activity</span>
          <input
            aria-label={`Filter ${meta.name} activity`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter activity"
            type="search"
            value={query}
          />
        </label>
        <strong>
          {normalizedQuery
            ? `${visibleEntries.length} ${visibleEntries.length === 1 ? "match" : "matches"}`
            : visibleCount < entries.length
            ? `${entries.length - visibleCount} incoming`
            : `${entries.length} recorded ${entries.length === 1 ? "event" : "events"}`}
        </strong>
      </div>
      <div
        className="terminal-screen"
        aria-label={`${meta.name} activity stream`}
        aria-live="polite"
        onScroll={updateFollowMode}
        ref={screenRef}
      >
        {entries.length === 0 ? (
          <div className="terminal-empty">
            <span>$</span>
            <p>{status === "skipped" ? "Review passed. No change session was required." : "No public activity has been recorded for this stage yet."}</p>
          </div>
        ) : (
          visibleEntries.map((entry, index) =>
            ["progress", "status", "test", "action"].includes(entry.kind) ? (
              <div className={`activity-entry entry-${entry.kind}`} key={entry.key}>
                <span className="activity-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <header>
                    <strong>{entry.title || entry.label}</strong>
                    <small>{formatEventTime(entry.at)}</small>
                  </header>
                  <p>{entry.text}</p>
                </div>
              </div>
            ) : (
              <details
                className={`terminal-entry entry-${entry.kind}`}
                key={entry.key}
                open={entry.kind === "error" || index === visibleEntries.length - 1}
              >
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <small>{entry.label}</small>
                    <strong>{entry.title || entry.label}</strong>
                  </div>
                  <time>{formatEventTime(entry.at)}</time>
                </summary>
                <pre>{entry.text}</pre>
              </details>
            ),
          )
        )}
      </div>
      <footer className="terminal-footer">
        <span>session persisted</span>
        {status === "running" && !following ? (
          <button onClick={resumeLiveFollow} type="button">Resume live follow</button>
        ) : (
          <span>{status === "running" ? "following latest activity" : "readable output only"}</span>
        )}
      </footer>
    </article>
  );
}

function ExchangeFlow({
  cycle,
  events,
}: {
  cycle: Cycle;
  events: AgentEvent[];
}) {
  const stages = new Set([cycle.antigravityStage, cycle.codexStage]);
  const allEntries = events
    .filter(
      (event) =>
        stages.has(event.stage) &&
        ["prompt", "progress", "command", "status", "output", "test", "error"].includes(event.kind),
    );
  const entries = allEntries.slice(-10);

  return (
    <div className="exchange-flow" aria-label="Observable collaboration exchange">
      <header>
        <span>
          ROUND ACTIVITY
          {allEntries.length > entries.length ? ` · LATEST ${entries.length} OF ${allEntries.length}` : ""}
        </span>
        <p>Public prompts, narrated activity, evidence, and responses — never private chain-of-thought.</p>
      </header>
      <div className="exchange-track">
        {entries.length ? entries.map((event, index) => (
          <div className={`exchange-node exchange-${event.actor}`} key={event.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <b>{event.actor === "system" ? "Relay Room" : ACTOR_META[event.actor as "antigravity" | "codex"]?.name || "Verifier"}</b>
              <strong>{event.title}</strong>
            </div>
          </div>
        )) : (
          <div className="exchange-empty">The next prompt will appear here as soon as collaboration begins.</div>
        )}
      </div>
    </div>
  );
}

function ArtifactPreview({
  artifact,
  frameRef,
  frameHeight,
  onFrameLoad,
}: {
  artifact: ProjectArtifact;
  frameRef?: RefObject<HTMLIFrameElement | null>;
  frameHeight: number;
  onFrameLoad?: () => void;
}) {
  const source = artifact.previewUrl.startsWith("/artifact/")
    ? brokerUrl(artifact.previewUrl)
    : artifact.previewUrl;

  if (artifact.kind === "image") {
    // Project-local artifact URLs are dynamic and intentionally bypass Next's image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="artifact-media" src={source} alt={artifact.title} />;
  }
  if (artifact.kind === "video") {
    return <video className="artifact-media" src={source} controls preload="metadata" />;
  }
  if (artifact.kind === "audio") {
    return (
      <div className="artifact-audio">
        <strong>{artifact.title}</strong>
        <audio src={source} controls preload="metadata" />
      </div>
    );
  }
  if (artifact.kind === "text") {
    return <TextArtifactPreview key={source} source={source} title={artifact.title} />;
  }
  if (["web", "pdf"].includes(artifact.kind)) {
    return (
      <div className="artifact-web-preview">
        <div className="artifact-preview-bar">
          <span>{artifact.kind === "web" ? "INTERACTIVE PREVIEW" : "DOCUMENT PREVIEW"}</span>
          <a href={source} rel="noreferrer" target="_blank">Open full preview ↗</a>
        </div>
        <iframe
          ref={frameRef}
          onLoad={onFrameLoad}
          sandbox={
            artifact.kind === "web" && artifact.previewUrl.startsWith("/artifact/")
              ? "allow-forms allow-modals allow-pointer-lock allow-same-origin allow-scripts"
              : undefined
          }
          scrolling="yes"
          src={source}
          style={{ height: `${frameHeight}px` }}
          title={`${artifact.title} preview`}
        />
      </div>
    );
  }
  return (
    <div className="artifact-generic">
      <span>FILE OUTPUT</span>
      <h3>{artifact.title}</h3>
      <p>{artifact.path}</p>
      <a href={source} rel="noreferrer" target="_blank">Open artifact</a>
    </div>
  );
}

function TextArtifactPreview({ source, title }: { source: string; title: string }) {
  const [preview, setPreview] = useState<{
    status: "loading" | "ready" | "error";
    content: string;
  }>({ status: "loading", content: "" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(source, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Preview failed with ${response.status}.`);
        const content = await response.text();
        const limit = 200_000;
        setPreview({
          status: "ready",
          content: content.length > limit
            ? `${content.slice(0, limit)}\n\n[Preview truncated after ${limit.toLocaleString()} characters.]`
            : content,
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreview({
          status: "error",
          content: error instanceof Error ? error.message : "Unable to load this text artifact.",
        });
      });
    return () => controller.abort();
  }, [source]);

  return (
    <pre
      className={`artifact-text-preview is-${preview.status}`}
      aria-label={`${title} text preview`}
      aria-live="polite"
    >
      {preview.status === "loading" ? "Loading text preview…" : preview.content}
    </pre>
  );
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<GlassboxState>(EMPTY_STATE);
  const [brokerOnline, setBrokerOnline] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState("foundation");
  const [now, setNow] = useState(0);
  const [gameRevision, setGameRevision] = useState(0);
  const [reviewCap, setReviewCap] = useState(5);
  const [providerUsage, setProviderUsage] = useState<ProviderUsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactHeight, setArtifactHeight] = useState(760);
  const artifactFrameRef = useRef<HTMLIFrameElement>(null);
  const artifactObserverRef = useRef<ResizeObserver | null>(null);
  const cycleNavRef = useRef<HTMLElement>(null);
  const previousRunStatus = useRef<GlassboxState["status"]>("idle");
  const followedStageRef = useRef<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch(brokerUrl("/api/state"), { cache: "no-store" });
      if (!response.ok) throw new Error("broker unavailable");
      const next = (await response.json()) as GlassboxState;
      setSnapshot(next);
      setBrokerOnline(true);
      setNow(Date.now());
      if (next.status === "complete") setGameRevision(next.events.length);
    } catch {
      setBrokerOnline(false);
    }
  }, []);

  const loadProviderUsage = useCallback(async (force = false) => {
    setUsageLoading(true);
    try {
      const response = await fetch(
        brokerUrl(force ? "/api/usage/refresh" : "/api/usage"),
        { method: force ? "POST" : "GET", cache: "no-store" },
      );
      if (!response.ok) throw new Error("allowance unavailable");
      setProviderUsage((await response.json()) as ProviderUsageSnapshot);
    } catch {
      setProviderUsage((current) => current || {
        sampledAt: new Date().toISOString(),
        codex: {
          status: "unavailable",
          remainingPercent: null,
          error: "Start the local broker and sign in to Codex.",
        },
        antigravity: {
          status: "unavailable",
          remainingPercent: null,
          error: "Start the local broker and sign in to Antigravity.",
        },
      });
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(loadState, 0);
    const pollTimer = window.setInterval(loadState, 700);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(pollTimer);
    };
  }, [loadState]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadProviderUsage(), 0);
    const pollTimer = window.setInterval(() => void loadProviderUsage(), 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(pollTimer);
    };
  }, [loadProviderUsage]);

  useEffect(() => {
    const previous = previousRunStatus.current;
    previousRunStatus.current = snapshot.status;
    if (
      previous === "running" &&
      ["complete", "failed", "stopped"].includes(snapshot.status)
    ) {
      void loadProviderUsage(true);
    }
  }, [loadProviderUsage, snapshot.status]);

  useEffect(() => () => artifactObserverRef.current?.disconnect(), []);

  const cycles = useMemo(() => discoverCycles(snapshot), [snapshot]);
  const activeCycle = cycles.find((cycle) => cycle.id === selectedCycle) || cycles[0];
  const runningCycleId = useMemo(
    () => cycles.find((cycle) =>
      cycle.antigravityStage === snapshot.activeStage ||
      cycle.codexStage === snapshot.activeStage
    )?.id,
    [cycles, snapshot.activeStage],
  );

  useEffect(() => {
    const terminal = ["complete", "failed", "stopped"].includes(snapshot.status);
    const followKey = terminal ? "complete" : snapshot.activeStage;
    const targetCycleId = terminal
      ? cycles.find((cycle) => cycle.id === "completion")?.id
      : runningCycleId;
    if (!followKey || !targetCycleId || followedStageRef.current === followKey) return;

    followedStageRef.current = followKey;
    setSelectedCycle(targetCycleId);
  }, [cycles, runningCycleId, snapshot.activeStage, snapshot.status]);

  useEffect(() => {
    const nav = cycleNavRef.current;
    if (!nav) return;
    const revealSelectedCycle = () => {
      const selected = nav.querySelector<HTMLElement>(`[data-cycle-id="${activeCycle.id}"]`);
      if (!selected || nav.scrollWidth <= nav.clientWidth) return;
      const targetLeft = selected.offsetLeft - (nav.clientWidth - selected.clientWidth) / 2;
      nav.scrollTo({ behavior: "smooth", left: Math.max(0, targetLeft) });
    };
    const observer = new ResizeObserver(revealSelectedCycle);
    observer.observe(nav);
    window.addEventListener("resize", revealSelectedCycle);
    revealSelectedCycle();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", revealSelectedCycle);
    };
  }, [activeCycle.id]);

  const agyEntries = useMemo(
    () => buildSession(snapshot.events, activeCycle.antigravityStage, "antigravity"),
    [activeCycle.antigravityStage, snapshot.events],
  );
  const codexEntries = useMemo(
    () => buildSession(snapshot.events, activeCycle.codexStage, "codex"),
    [activeCycle.codexStage, snapshot.events],
  );
  const reviewCount = Math.max(0, cycles.length - 1);
  const plannedReviews = snapshot.reviewBudget || reviewCount;
  const duration = formatDuration(snapshot.startedAt, snapshot.finishedAt, now);
  const usage = useMemo(() => collectRunUsage(snapshot.events), [snapshot.events]);
  const selectedReviewCap = snapshot.status === "running"
    ? snapshot.reviewCap || reviewCap
    : reviewCap;
  const effectiveReviewCap = Math.max(1, Math.min(12, selectedReviewCap));
  const artifacts = useMemo<ProjectArtifact[]>(() => {
    if (snapshot.artifacts?.length) return snapshot.artifacts;
    if (snapshot.mode === "host") return [];
    return [{
      id: "reference-snake",
      path: "public/game",
      title: "Neon Snake",
      kind: "web",
      description: "Canvas game with keyboard, touch, pause, restart, local best score and a deterministic debug API.",
      previewUrl: `/game/index.html?revision=${gameRevision}`,
    }];
  }, [gameRevision, snapshot.artifacts, snapshot.mode]);
  const activeArtifact =
    artifacts.find((artifact) => artifact.id === selectedArtifactId) ||
    artifacts[0] ||
    null;

  const fitArtifact = useCallback(() => {
    const frame = artifactFrameRef.current;
    const document = frame?.contentDocument;
    if (!frame || !document) return;

    const measure = () => {
      const nextHeight = Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        360,
      );
      setArtifactHeight(Math.ceil(nextHeight));
    };

    artifactObserverRef.current?.disconnect();
    const observer = new ResizeObserver(measure);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    artifactObserverRef.current = observer;
    measure();
  }, []);

  const stopRun = async () => {
    const response = await fetch(brokerUrl("/api/stop"), { method: "POST" });
    if (response.ok) await loadState();
  };

  return (
    <main className="relay-app">
      <header className="app-header">
        <div className="wordmark">
          <span>C/A</span>
          <div>
            <strong>Colla Agent</strong>
            <small>LIVE CODEX × ANTIGRAVITY WORKSPACE</small>
          </div>
        </div>
        <div className="project-title">
          <small>{snapshot.mode === "host" ? "ACTIVE PROJECT" : "REFERENCE WORKLOAD"}</small>
          <strong>{snapshot.project?.name || "Snake / browser game"}</strong>
        </div>
        <div className="header-actions">
          <span className={`connection ${brokerOnline ? "is-online" : "is-offline"}`}>
            {brokerOnline ? "BROKER ONLINE" : "BROKER OFFLINE"}
          </span>
          <div className="run-control">
            {snapshot.status === "running" ? (
              <button className="stop-cta" onClick={stopRun}>Stop after current step</button>
            ) : snapshot.mode === "host" ? (
              <button className="run-cta" disabled>Managed by Codex</button>
            ) : (
              <button className="run-cta" disabled>Start from Codex</button>
            )}
            <small>
              {snapshot.mode === "host"
                ? "Current Codex implements · Antigravity reviews"
                : "Use $relay-room-collaboration · no nested Codex"}
            </small>
          </div>
        </div>
      </header>

      <section className="run-overview" aria-label="Current run overview">
        <div className="overview-copy">
          <span className={`run-status status-${snapshot.status}`}>{STATUS_LABEL[snapshot.status]}</span>
          <div>
            <h1>{taskHeading(snapshot.task)}</h1>
            <p>
              {snapshot.task?.brief
                ? truncateText(snapshot.task.brief, 240)
                : "A transparent build-and-review loop with the current Codex in control."}
            </p>
          </div>
        </div>
        <div className="overview-data">
          <dl className="run-metrics">
            <div>
              <dt>COMPLEXITY</dt>
              <dd>{(snapshot.complexity || (reviewCount > 1 ? "high" : "low")).toUpperCase()}</dd>
            </div>
            <div>
              <dt>REVIEW PLAN</dt>
              <dd>
                {plannedReviews || "AUTO"} {plannedReviews === 1 ? "ROUND" : "ROUNDS"}
              </dd>
            </div>
            <div>
              <dt>ELAPSED</dt>
              <dd>{duration}</dd>
            </div>
            <div>
              <dt>RUN ID</dt>
              <dd>{snapshot.runId?.slice(-6) || "READY"}</dd>
            </div>
          </dl>

          <div className="usage-grid" aria-label="Provider allowance and usage">
            <article className="usage-card usage-codex">
              <header>
                <span>CODEX · ACCOUNT</span>
                <b>{providerUsage?.codex.planType?.toUpperCase() || "SIGNED-IN PLAN"}</b>
              </header>
              <AllowanceMeter allowance={providerUsage?.codex} loading={usageLoading && !providerUsage} />
              <p className="run-cost">
                THIS RUN · {usage.codex.turns} turns · {formatTokenCount(usage.codex.inputTokens)} in / {formatTokenCount(usage.codex.outputTokens)} out
                {usage.codex.cachedInputTokens
                  ? ` · ${formatTokenCount(usage.codex.cachedInputTokens)} cached`
                  : ""}
              </p>
            </article>
            <article className="usage-card usage-agy">
              <header>
                <span>ANTIGRAVITY · ACCOUNT</span>
                <b>{providerUsage?.antigravity.modelName || "GEMINI 3.6 FLASH HIGH"}</b>
              </header>
              <AllowanceMeter allowance={providerUsage?.antigravity} loading={usageLoading && !providerUsage} />
              <p className="run-cost">
                THIS RUN · {usage.antigravityCalls} CLI calls
                {providerUsage?.antigravity.availableCredits !== null &&
                providerUsage?.antigravity.availableCredits !== undefined
                  ? ` · ${providerUsage.antigravity.availableCredits} extra credits`
                  : ""}
              </p>
            </article>
            <article className="usage-card policy-card">
              <header><span>ITERATION GOVERNOR</span><b>BOUNDED</b></header>
              <label>
                <strong>Auto plan · max</strong>
                <select
                  aria-label="Maximum review rounds"
                  disabled={snapshot.status === "running" || snapshot.mode === "host"}
                  onChange={(event) => setReviewCap(Number(event.target.value))}
                  value={effectiveReviewCap}
                >
                  {[1, 3, 5, 8, 12].map((value) => (
                    <option key={value} value={value}>
                      {value} {value === 1 ? "round" : "rounds"}
                    </option>
                  ))}
                </select>
              </label>
              <p>Quick 1–3 · Standard 5 · Deep 8 · Maximum 12. Always stops on PASS, no progress, cap, or manual stop.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="console-workspace">
        <aside className="cycle-rail">
          <header>
            <span>ORCHESTRATION MAP</span>
            <strong>{cycles.length} cycles</strong>
          </header>
          <nav aria-label="Collaboration cycles" ref={cycleNavRef}>
            {cycles.map((cycle) => {
              const count =
                buildSession(snapshot.events, cycle.antigravityStage, "antigravity").length +
                buildSession(snapshot.events, cycle.codexStage, "codex").length;
              return (
                <button
                  className={cycle.id === activeCycle.id ? "cycle is-selected" : "cycle"}
                  data-cycle-id={cycle.id}
                  key={cycle.id}
                  onClick={() => setSelectedCycle(cycle.id)}
                >
                  <span>{String(cycle.number).padStart(2, "0")}</span>
                  <div>
                    <strong>{cycle.title}</strong>
                    <small>{cycle.note}</small>
                    <em>{count} entries</em>
                  </div>
                  <b className={`cycle-state state-${cycle.status}`}>{STATUS_LABEL[cycle.status]}</b>
                </button>
              );
            })}
          </nav>
          <div className="adaptive-note">
            <span>COLLABORATION ROUNDS</span>
            <p>Each round keeps its own prompt, public activity, review evidence, Codex response, and verification trail.</p>
          </div>
        </aside>

        <div className="session-area">
          <header className="session-heading">
            <div>
              <span>
                {activeCycle.id === "completion"
                  ? "FINAL HANDOFF"
                  : activeCycle.number === 0
                    ? "PLAN + BUILD"
                    : `ROUND ${activeCycle.number}`}
              </span>
              <h2>{activeCycle.title}</h2>
            </div>
            <p>{activeCycle.note} · live activity stays open; full prompts and responses remain inspectable</p>
          </header>
          <ExchangeFlow cycle={activeCycle} events={snapshot.events} />
          <div className="terminal-grid">
            <TerminalSession
              actor="antigravity"
              stage={activeCycle.antigravityStage}
              entries={agyEntries}
              key={`antigravity-${activeCycle.antigravityStage}`}
              status={stageStatus(snapshot, activeCycle.antigravityStage)}
            />
            <TerminalSession
              actor="codex"
              stage={activeCycle.codexStage}
              entries={codexEntries}
              key={`codex-${activeCycle.codexStage}`}
              status={stageStatus(snapshot, activeCycle.codexStage)}
            />
          </div>
        </div>
      </section>

      <section className="artifact-section">
        <header>
          <div>
            <span>OUTPUTS</span>
            <h2>What the current Codex produced</h2>
          </div>
          <button
            disabled={!activeArtifact}
            onClick={() => setGameRevision((value) => value + 1)}
          >
            Reload preview
          </button>
        </header>
        <div className="artifact-layout">
          <div className="artifact-summary">
            <span>{artifacts.length} {artifacts.length === 1 ? "DELIVERABLE" : "DELIVERABLES"}</span>
            <h3>{activeArtifact?.title || "Waiting for outputs"}</h3>
            <p>
              {activeArtifact?.description ||
                (activeArtifact
                  ? activeArtifact.path
                  : "The host Codex will register pages, media, documents, code and other outputs here.")}
            </p>
            {artifacts.length > 0 && (
              <nav className="artifact-list" aria-label="Produced artifacts">
                {artifacts.map((artifact) => (
                  <button
                    className={artifact.id === activeArtifact?.id ? "is-selected" : ""}
                    key={artifact.id}
                    onClick={() => setSelectedArtifactId(artifact.id)}
                  >
                    <span>{artifact.kind.toUpperCase()}</span>
                    <strong>{artifact.title}</strong>
                    <small>{artifact.path}</small>
                  </button>
                ))}
              </nav>
            )}
            <dl>
              <div><dt>OWNER</dt><dd>Codex</dd></div>
              <div><dt>REVIEWER</dt><dd>Antigravity</dd></div>
              <div><dt>RESULT</dt><dd>{snapshot.status === "complete" ? "Verified" : snapshot.status === "failed" ? "Needs attention" : "In progress"}</dd></div>
              <div><dt>TYPE</dt><dd>{activeArtifact?.kind.toUpperCase() || "PENDING"}</dd></div>
            </dl>
          </div>
          <div className="artifact-frame">
            {activeArtifact ? (
              <ArtifactPreview
                artifact={activeArtifact}
                frameHeight={activeArtifact.previewUrl.startsWith("/artifact/") ? 820 : artifactHeight}
                frameRef={activeArtifact.previewUrl.startsWith("/game/") ? artifactFrameRef : undefined}
                key={`${activeArtifact.id}-${gameRevision}`}
                onFrameLoad={activeArtifact.previewUrl.startsWith("/game/") ? fitArtifact : undefined}
              />
            ) : (
              <div className="artifact-empty">
                <span>NO OUTPUTS YET</span>
                <p>Registered deliverables will appear here while Codex works.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
