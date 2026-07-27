# Colla Agent live trace redesign

## Product decision

Use **Colla Agent** as the product and Skill-facing name. Keep **Relay Room**
as the local runtime and protocol name so existing commands and stored traces
remain compatible.

The interface should answer three questions within five seconds:

1. What is the current Codex building?
2. What did Antigravity ask, inspect, or challenge in this round?
3. What evidence proves the work changed or passed?

The physical scene is a developer watching a long-running implementation on a
second monitor in normal office light. The UI should feel like an operations
workspace: dense enough to follow, calm enough to leave open, and explicit
about what is live versus recorded.

## Approaches considered

### A. Keep two terminal cards and parse more JSON

This is the smallest change, but it preserves the underlying failure: host
Codex work is not a nested CLI session and therefore does not naturally emit
Codex JSONL. It would continue treating normal collaboration events as a
special case.

### B. Introduce a shared activity-event protocol

Both participants publish explicit `progress`, `prompt`, `command`, `test`,
`output`, and `error` events. Antigravity stdout is streamed into safe public
progress lines as it runs. The current Codex records meaningful inspection,
decision, edit, and verification milestones through a concise `activity`
command. The dashboard renders these events directly.

This is the recommended approach because it matches the real ownership model:
the host Codex is the worker, the CLI is the observer, and the dashboard is a
reader rather than a JSONL decoder.

### C. Capture every shell and filesystem operation automatically

This would be the most exhaustive, but it would require wrapping or
instrumenting Codex itself, creating the same recursive/process-coupling
problem the product is designed to avoid. It would also generate noisy traces
and risk recording secrets.

## Event and streaming model

Add `progress` as a first-class event kind.

- Antigravity: the CLI incrementally reads stdout, extracts explicit public
  activity narration, and appends bounded progress events before recording the
  final structured response.
- Codex: the Skill records meaningful milestones with
  `relay-room activity --stage <stage> --title <title> --content <evidence>`.
- Verifier: test events remain distinct and appear in the Codex workstream
  because verification is evidence for the implementation.

The UI must never label these lines as private thoughts. They are public
activity summaries, tool evidence, prompts, or explicit responses.

## Interface structure

- Top bar: Colla Agent identity, active project, connection, safe-stop state.
- Run overview: short reader-facing mission title, project brief, elapsed time,
  review budget, provider allowance.
- Round navigator: Foundation plus each review/refinement round, with live,
  complete, queued, or passed state.
- Active exchange: an always-visible sequence of public events for the selected
  round.
- Workstreams: Antigravity and Codex activity feeds. Progress lines are open
  and arrive individually; large prompts and final responses remain expandable.
- Deliverables: every registered artifact with native preview.

Use restrained neutral surfaces, a dark operational top bar, cobalt for Codex,
magenta for Antigravity, and green only for verified/pass states. Motion is
limited to a 180–220 ms arrival transition and a live pulse, with a
reduced-motion fallback.

## Verification

- Unit/integration tests prove host Codex progress, verifier evidence, streamed
  Antigravity lines, and round separation.
- A difficult non-Snake artifact proves generic implementation and preview.
- Browser checks cover desktop, mobile, live/complete states, round switching,
  readable prompt/output details, and artifact interaction.
- The final run must show non-zero meaningful entries for both Codex and
  Antigravity.
