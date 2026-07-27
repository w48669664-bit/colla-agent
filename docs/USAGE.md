# Colla Agent Usage Guide

This guide covers local installation, Skill invocation, runtime commands,
artifacts, stopping and common recovery steps.

## Prerequisites

- macOS or another Node.js-compatible development environment
- Node.js `22.13+ LTS` or `24+`
- Codex with local Skill support
- Antigravity CLI available as `agy`
- Authenticated Codex and Antigravity accounts if provider allowance cards are
  required

Verify the tools:

```bash
node --version
npm --version
agy --help
```

## Install the workspace

```bash
git clone https://github.com/w48669664-bit/colla-agent.git
cd colla-agent
npm install
```

Start the local broker and Dashboard:

```bash
npm run colla-agent
```

The UI uses `http://127.0.0.1:3000`; the broker uses
`http://127.0.0.1:8787`.

## Install the Codex Skill

Symlink the Skill so repository updates take effect immediately:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/relay-room-collaboration" \
  ~/.codex/skills/relay-room-collaboration
```

If `~/.codex/skills/relay-room-collaboration` already exists, inspect it first.
Do not overwrite an unrelated directory.

Restart or refresh Codex if the Skill is not discovered immediately.

## Invoke Colla Agent

In a Codex task:

```text
Use $relay-room-collaboration to implement team invitations.
Use $relay-room-collaboration in deep mode to refactor the payment boundary.
Ask Antigravity to review this migration with Colla Agent and keep a visible trace.
```

The Skill will:

1. read the target project's instructions;
2. start/reuse the Dashboard and open it;
3. ask Antigravity for a read-only plan;
4. let the current Codex implement and publish activity;
5. run bounded review/refinement rounds;
6. register outputs and persist the stop reason.

## Review caps

| Mode | Typical cap |
| --- | ---: |
| Quick / simple | 3 |
| Standard | 5 |
| Deep / high risk | 8 |
| Maximum audit | 12 |

An explicit user cap wins. Antigravity may recommend a smaller budget. PASS
always stops early.

## Runtime CLI

Commands are executed through:

```bash
node skills/relay-room-collaboration/scripts/relay-room.mjs <command>
```

Useful commands:

```bash
# Current state
node skills/relay-room-collaboration/scripts/relay-room.mjs status

# Reopen the Dashboard
node skills/relay-room-collaboration/scripts/relay-room.mjs open

# Request a safe stop
node skills/relay-room-collaboration/scripts/relay-room.mjs stop

# Stop services only when no longer needed
node skills/relay-room-collaboration/scripts/relay-room.mjs shutdown
```

The Skill normally drives the remaining commands automatically:

```text
start
consult plan
activity
event
consult review
artifact
finish
```

See the [protocol reference](../skills/relay-room-collaboration/references/protocol.md)
for fields and lifecycle details.

## Registering artifacts

Artifact paths are relative to the active target project:

```bash
node skills/relay-room-collaboration/scripts/relay-room.mjs artifact \
  --path dist \
  --title "Production application" \
  --description "Built frontend ready for review"
```

A web directory must contain `index.html`. Paths outside the active project
are rejected.

## Local traces

Each target project receives:

```text
.relay-room/current.json
.relay-room/runs/<run-id>/snapshot.json
.relay-room/runs/<run-id>/responses/
```

The Colla Agent runtime also mirrors the current session in `.agent-bus/`.
Treat both directories as potentially sensitive.

## Troubleshooting

### Dashboard says broker offline

Run:

```bash
npm run colla-agent
curl http://127.0.0.1:8787/health
```

### Skill is not found

Confirm the link:

```bash
ls -la ~/.codex/skills/relay-room-collaboration
```

Then restart or refresh Codex.

### Antigravity consultation fails

Confirm `agy` is on `PATH` and authenticated:

```bash
command -v agy
agy --help
```

The complete failure is saved in the active run snapshot.

### A previous run is still active

Inspect it before stopping:

```bash
node skills/relay-room-collaboration/scripts/relay-room.mjs status
node skills/relay-room-collaboration/scripts/relay-room.mjs stop
```

### Port conflict

Override the defaults:

```bash
GLASSBOX_PORT=8877 \
RELAY_ROOM_BROKER_URL=http://127.0.0.1:8877 \
npm run colla-agent
```

The Dashboard URL can be overridden with `RELAY_ROOM_DASHBOARD_URL`.

## Updating

```bash
git pull --ff-only
npm install
```

A symlinked Skill updates with the repository. Restart the local services if
runtime files changed.
