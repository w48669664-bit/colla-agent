# Relay Room protocol

## Commands

All commands use the Skill wrapper:

```bash
node <skill-dir>/scripts/relay-room.mjs <command>
```

| Command | Purpose |
| --- | --- |
| `start` | Start services, create a host run, and open the dashboard |
| `consult plan` | Ask Antigravity for a read-only plan and review budget |
| `consult review` | Ask Antigravity to review the current project |
| `activity` | Record a concise public Current Codex progress milestone |
| `event` | Record a Codex, verifier, system, or Antigravity event |
| `configure` | Override complexity and budget within the selected cap |
| `artifact` | Register an output inside the active project |
| `finish` | Persist final status, reason, and summary |
| `status` | Print the current snapshot |
| `open` | Reopen the dashboard |
| `stop` | Request a safe stop |
| `shutdown` | Stop runtime processes started by the CLI |

## Review presets

Relay Room accepts only the nearest supported cap:

| Preset | Cap | Intended use |
| --- | ---: | --- |
| Quick | 1 or 3 | Small, low-risk changes |
| Standard | 5 | Default multi-file work |
| Deep | 8 | Architecture, migrations, broad redesigns |
| Maximum | 12 | Explicit high-risk audit work |

Antigravity recommends a budget at or below the cap. PASS always stops early.
Three consecutive identical `mustFix` signatures trigger the no-progress guard.

## Event fields

`event` accepts:

- `--actor`: `codex`, `antigravity`, `verifier`, or `system`
- `--stage`: `blueprint`, `implement`, `review-N`, `refine-N`, or a focused
  project stage
- `--kind`: `status`, `progress`, `prompt`, `command`, `output`, `test`, or `error`
- `--status`: `pending`, `running`, `complete`, `failed`, or `skipped`
- `--title`: short timeline label
- `--content`, `--file`, or stdin: visible event content

Do not record credentials, authorization headers, personal secrets, or private
chain-of-thought.

`consult` publishes each usable Antigravity stdout line as a bounded
`progress` event. When the CLI stays quiet, Colla Agent emits an explicitly
labeled liveness pulse; it never fabricates hidden reasoning. Use `activity`
for reader-facing Codex inspections, decisions, edit groups, and verification
milestones.

## Artifacts

Artifact paths must remain inside the active project root. Relay Room infers:

- directory or HTML: `web`
- PNG, JPEG, GIF, SVG, WebP: `image`
- MP4, WebM, MOV: `video`
- MP3, WAV: `audio`
- PDF: `pdf`
- source, Markdown, JSON, CSV, XML, or plain text: `text`
- everything else: `file`

Use `--kind` only to correct an inference. A web directory must contain
`index.html`; relative CSS, scripts, images, and media are served from the same
path-safe local artifact route.

## Files

The runtime mirror is:

```text
<relay-room-runtime>/.agent-bus/snapshot.json
```

The durable project trace is:

```text
<project>/.relay-room/current.json
<project>/.relay-room/runs/<run-id>/snapshot.json
<project>/.relay-room/runs/<run-id>/responses/
```

Each run is independently replayable even after another project becomes
active.

## HTTP lifecycle

The local broker uses:

- `POST /api/session/start`
- `POST /api/session/event`
- `POST /api/session/configure`
- `POST /api/session/artifact`
- `POST /api/session/finish`
- `GET /api/state`
- `POST /api/stop`
- `GET /artifact/<project-relative-path>`

The dashboard defaults to `http://127.0.0.1:3000` and the broker to
`http://127.0.0.1:8787`. Override them with
`RELAY_ROOM_DASHBOARD_URL` and `RELAY_ROOM_BROKER_URL`.
