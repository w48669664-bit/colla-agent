# Relay Room reusable collaboration skill

## Decision

Build Relay Room as two cooperating layers:

1. A project-independent local CLI and dashboard runtime in this repository.
2. A globally discoverable Codex Skill whose canonical source remains in
   `skills/relay-room-collaboration/`.

Install the Skill into `~/.codex/skills/relay-room-collaboration` with a
symlink so repository changes and the installed behavior cannot drift.

Do not spawn a nested Codex process when the Skill is invoked from Codex.
The current Codex session remains the sole implementation agent. The Skill
uses the Relay Room CLI to start tracing, ask Antigravity for read-only plans
and reviews, record Codex handoffs and verification, and finish the run.

## Invocation and data flow

Example:

```text
Use $relay-room-collaboration to add team invitations to this project.
Use $relay-room-collaboration in deep mode to redesign this dashboard.
```

The Skill performs this bounded workflow:

1. Start the local broker and dashboard for the current working directory,
   create a run, and open the dashboard.
2. Record the user brief and ask Antigravity for a read-only plan and
   complexity assessment.
3. Let the current Codex session inspect, edit, and test the project.
4. Record a concise Codex handoff containing decisions, changed files,
   evidence, and questions.
5. Ask Antigravity to review the current project, then let Codex accept or
   challenge findings and implement justified fixes.
6. Repeat until PASS, repeated findings, the selected cap, manual stop, or a
   blocking failure.
7. Register output artifacts and mark the run complete.

Every prompt, explicit response, command summary, file change, test result,
phase transition, and stop reason is written to the run snapshot. Hidden
chain-of-thought is neither requested nor displayed; the dashboard shows
explicit rationale, evidence, and observable work.

## Iteration policy

Expose fixed caps of 1, 3, 5, 8, and 12 review rounds.

- Quick: 1 or 3
- Standard: 5 (default)
- Deep: 8
- Maximum: 12

Antigravity recommends a review budget based on complexity without exceeding
the user-selected cap. Relay Room stops early on PASS. It also stops when three
consecutive reviews contain the same must-fix signature, when the cap is
reached, or when the user requests a stop. No mode permits an infinite loop.

## Runtime components

### Generic run state

Extend the snapshot with:

- `mode`: `host`
- `project`: root, name, and relative display label
- `task`: title and complete brief
- `reviewPreset`, `reviewCap`, and `reviewBudget`
- `artifacts`: path, title, kind, media type, and preview URL
- `events`: existing actor/stage/kind records

The broker accepts host-session lifecycle and event endpoints. Legacy
autonomous run endpoints return HTTP 410 so the dashboard cannot launch a
nested Codex implementation.

### Relay Room CLI

Add `scripts/relay-room.mjs` with commands:

- `start`: start or reuse local services, initialize a host run, and open UI
- `event`: append a Codex/system/verifier event from stdin
- `consult`: invoke Antigravity for planning or review and record both sides
- `configure`: record complexity and review budget
- `artifact`: register a produced file or directory
- `finish`: record the terminal status and stop reason
- `status`: print the current run snapshot

All paths must resolve inside the selected project root. Credentials and
provider tokens must never enter events or artifacts.

### Generic artifact browser

Serve registered project files through a path-safe broker route. The dashboard
lists every registered output and chooses a native preview:

- HTML file or directory with `index.html`: interactive iframe
- Image: inline image
- Video or audio: native media controls
- PDF or text/code: iframe/text preview
- Other file: metadata and an open/download link

The Snake game remains a reference workload and fallback artifact, not a
hard-coded product assumption.

## Errors and recovery

- If the dashboard cannot start, keep the workflow usable from the CLI and
  print the exact local URL or failure.
- If Antigravity fails, record the failed command and preserve the run so it
  can resume at the review stage.
- If an artifact path escapes the project root or does not exist, reject it.
- If a provider quota lookup fails, retain the explicit unavailable state.
- A restarted broker reloads the current run from disk.

## Verification

1. Unit-test CLI parsing, safe artifact resolution, generic prompts, iteration
   caps, state transitions, and stop conditions.
2. Run the existing Snake smoke test to preserve the reference workload.
3. Forward-test the Skill against a temporary non-Snake project without
   invoking a nested Codex process.
4. Visually verify desktop and mobile dashboards, dialogue flow, artifact
   lists, interactive HTML preview, and unavailable states.
5. Run Skill validation, lint, rendered UI tests, and production build.
