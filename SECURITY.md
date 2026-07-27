# Security Policy

## Supported versions

Colla Agent is currently pre-1.0. Security fixes target the latest `main`
branch and the most recent tagged release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / Security Advisory flow:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include affected files, reproduction steps, impact and any suggested fix.

Do not include credentials, access tokens, private run snapshots or personal
project content in a public issue.

## Local trust boundaries

Colla Agent is a local development tool and should be run only on projects you
are authorized to inspect and modify.

- The current Codex session is the only implementation writer.
- Antigravity runs in `plan + sandbox` mode and is instructed to remain
  read-only.
- The headless Antigravity command uses
  `--dangerously-skip-permissions` to avoid an interactive approval deadlock.
  This does **not** make arbitrary projects trustworthy. Review the command,
  the target project and your local Antigravity configuration before use.
- Registered web artifacts execute inside a sandboxed iframe, but generated
  code should still be treated as untrusted.
- Artifact paths are realpath-checked against the active project root.
- Provider credentials are read from local authenticated tools and must never
  be copied into events, snapshots or Git commits.

## Data stored locally

Colla Agent stores run data in:

```text
<project>/.relay-room/
<colla-agent-runtime>/.agent-bus/
```

These directories can contain prompts, project paths, model responses and test
evidence. They are ignored by this repository, but a target project should
also ignore `.relay-room/` if its traces are not intended for version control.

Before publishing a project, scan for:

- `.relay-room/` and `.agent-bus/`;
- `.env*`, keys, tokens and private certificates;
- absolute user paths;
- screenshots containing authentication URLs or account information.

## Scope

Reports about the security of Codex, Antigravity, GitHub, Node.js or other
upstream products should be sent to their respective maintainers unless the
issue is caused by Colla Agent's integration code.
