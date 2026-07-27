# Relay Room

This repository provides a transparent collaboration control plane for a
current Codex session and the Antigravity CLI. Snake remains the reference
workload used by repository smoke tests; it is not the product boundary.

## Roles

- In Skill-driven host mode, the current Codex session is the only
  implementation agent. Never invoke `codex`, `codex exec`, another Codex
  session, a subagent, or any recursive agent workflow.
- Antigravity is always a read-only planner and reviewer. It must not edit
  project files or invoke other agents.
- Record meaningful prompts, explicit responses, command summaries, file
  changes, tests, and phase transitions. Never record credentials or claim to
  expose private chain-of-thought.

## Iteration policy

- Supported review caps are 1, 3, 5, 8, and 12 rounds. Default to 5.
- Let Antigravity recommend a budget within the selected cap.
- Stop early on PASS.
- Stop on three consecutive repeated must-fix signatures, the selected cap, a manual stop,
  or a blocking failure.
- Never run an infinite review loop or silently raise the cap.

## Generic deliverables

- Keep writes inside the active user-selected project.
- Register meaningful outputs in Relay Room after implementation.
- Preview HTML directories interactively; use native previews for images,
  video, audio, PDF, and text where possible.
- Persist each host run under `.relay-room/runs/<run-id>/` in the active
  project.

## Reference Snake deliverable

- Keep the standalone Canvas game in `public/game/`.
- Preserve keyboard and touch controls, score, best score, pause/resume,
  restart, game-over state, and deterministic `window.__snakeDebug`.
- Keep the reference game dependency-free.

## Repository validation

- Run `npm run lint`.
- Run `npm test`.
- Run `node tests/smoke-game.mjs`.
- Validate `skills/relay-room-collaboration/` with the Skill validator.
