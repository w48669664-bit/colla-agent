---
name: relay-room-collaboration
description: Run Colla Agent, a traceable bounded collaboration loop in which the current Codex session implements a project and Antigravity plans and reviews it read-only. Use for complex or high-risk coding, design, refactoring, debugging, document, media, data, or multi-file project work when the user asks for Colla Agent, Relay Room, Codex–Antigravity collaboration, repeated independent review, a live observable handoff, a reusable collaboration workflow, or automatic visual tracking. Also trigger implicitly when a user asks Codex to use Antigravity as a reviewing colleague and keep a replayable local trace.
---

# Colla Agent Collaboration

Keep the current Codex session as the only implementation agent. Use the
bundled Relay Room runtime to open Colla Agent, consult Antigravity read-only,
record observable work, and publish produced artifacts. Never invoke `codex`, `codex exec`, a
subagent, or another recursive agent session from this workflow.

## Prepare

1. Resolve the absolute path to `scripts/relay-room.mjs` from this Skill
   directory.
2. Read the target project's `AGENTS.md` and relevant instructions.
3. Inspect the worktree before editing. Preserve unrelated user changes.
4. Choose a review cap:
   - explicit user choice wins;
   - quick or simple: 3;
   - standard/default: 5;
   - deep or high-risk: 8;
   - maximum audit: 12.
5. Start Relay Room for the current project and complete task brief:

```bash
node <skill-dir>/scripts/relay-room.mjs start \
  --project <absolute-project-root> \
  --task "<complete user request>" \
  --title "<short reader-facing mission title>" \
  --rounds 5
```

The command starts or reuses the local dashboard and opens it automatically.
Give the dashboard URL to the user in the next progress update.

## Plan with Antigravity

Run:

```bash
node <skill-dir>/scripts/relay-room.mjs consult plan
```

Read the returned JSON. Treat it as colleague advice, not authority. Resolve
conflicts against the user request and project instructions. The CLI records
the prompt, explicit rationale, questions, output, and adaptive review budget.
Do not request or claim private chain-of-thought.

## Implement as the current Codex

Record the start of implementation:

```bash
node <skill-dir>/scripts/relay-room.mjs event \
  --actor codex --stage implement --kind status --status running \
  --title "Codex is implementing" \
  --content "<concise implementation plan>"
```

Use normal Codex tools to edit the target project. Do not run a nested Codex
CLI. Keep the Colla Agent Codex workstream alive while working. Before and
after each meaningful inspection, decision, edit group, and verification,
record one short public activity event:

```bash
node <skill-dir>/scripts/relay-room.mjs activity \
  --stage implement \
  --title "Inspecting the authorization boundary" \
  --content "Reading the router, policy layer, and existing tests before changing behavior."
```

For review fixes, use `--stage refine-<n>`. Record meaningful milestones rather
than every trivial command:

- decisions and rejected alternatives;
- changed files;
- verification commands and results;
- blockers or recoveries;
- a concise handoff with questions for Antigravity.

Never label these public summaries as private reasoning. They should describe
observable actions, decisions, and evidence in reader-facing language.

Use `event --kind output --status complete` for the final implementation
handoff. Pass long content through stdin or `--file`.

## Review and refine

For each scheduled round, run:

```bash
node <skill-dir>/scripts/relay-room.mjs consult review \
  --round <n> \
  --handoff-file <codex-handoff-file>
```

Then:

1. Parse `verdict`, `mustFix`, `findings`, `questions`, and
   `messageToCodex`.
2. If the verdict is `PASS`, stop reviewing and finish.
3. Otherwise record `refine-<n>` as running.
4. Accept findings supported by project evidence; challenge unsupported ones
   with file or test evidence.
5. Implement justified fixes, run proportional verification, and record a new
   Codex handoff as `refine-<n>` output with status complete.
6. Start the next review only when the run is still active and under its cap.

Stop on PASS, a pending manual stop, repeated must-fix findings, the selected
cap, or a blocking failure. Never extend the cap silently and never loop
indefinitely.

## Publish deliverables

Register each meaningful output relative to the project root:

```bash
node <skill-dir>/scripts/relay-room.mjs artifact \
  --path <relative-path> \
  --title "<reader-facing title>" \
  --description "<what this output is>"
```

Register directories containing `index.html` for interactive websites or
games. Register images, video, audio, PDFs, text/code, and other files
individually when they are useful outputs. Relay Room selects the appropriate
preview automatically.

Finish the trace:

```bash
node <skill-dir>/scripts/relay-room.mjs finish \
  --status complete \
  --reason pass \
  --summary "<result, verification, and remaining caveats>"
```

Use `failed`, `stopped`, `review_cap`, or `no_progress` honestly when
appropriate. In the final user response include the dashboard URL, trace file,
registered artifacts, review count, stop reason, and verification results.

## Recover

- Run `status` to inspect the current snapshot.
- Run `open` to reopen the dashboard.
- Run `stop` to request a safe stop.
- Run `shutdown` only when the user asks to stop Relay Room services.
- Read [references/protocol.md](references/protocol.md) when adding commands,
  diagnosing lifecycle failures, or integrating another artifact type.
