# Contributing to Colla Agent

感谢你愿意改进 Colla Agent。这个项目把协作可观察性和安全边界放在功能数量
之前，因此行为变化需要同时考虑运行时、界面、Skill 说明和验证证据。

## Before you start

- Search existing issues before opening a new one.
- Use a focused branch and keep changes scoped to one concern.
- Never commit credentials, local provider state, `.agent-bus/` or `.relay-room/`.
- Preserve the single-writer invariant: the current Codex session implements;
  Antigravity remains read-only.
- Do not add recursive agent calls or unbounded review loops.

## Local setup

```bash
git clone https://github.com/w48669664-bit/colla-agent.git
cd colla-agent
npm install
npm run colla-agent
```

Node.js `22.13+ LTS` or `24+` is required.

## Development workflow

1. Create a branch:

   ```bash
   git switch -c feature/short-description
   ```

2. Make the smallest coherent change that solves the issue.
3. Update tests and documentation when behavior changes.
4. Run the complete validation suite.
5. Open a Pull Request using the repository template.

## Required validation

```bash
npm run lint
npm test
npm run test:game
npm run test:simulator
```

When changing `skills/relay-room-collaboration/`, also run the Codex Skill
validator available in your local Codex installation.

## Architecture invariants

- **Current Codex is the only writer.**
- **Antigravity is read-only.**
- Public activity is not private chain-of-thought.
- Review caps stay within `1, 3, 5, 8, 12`.
- PASS, repeated must-fix findings, cap, manual stop and failure remain terminal.
- Artifact paths resolve inside the active project root.
- New artifact renderers must preserve sandbox and content-type boundaries.
- Mobile layouts must not introduce page-level horizontal overflow.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for component details.

## Commit and PR guidance

Use clear imperative commit messages, for example:

```text
Add terminal activity filtering
Fix completion-stage visibility
Document local Skill installation
```

Pull Requests should explain:

- the user problem;
- the implementation and trade-offs;
- validation commands and results;
- screenshots for visible changes;
- security or compatibility considerations.

## Reporting security issues

Do not open a public issue for vulnerabilities or leaked credentials. Follow
[SECURITY.md](./SECURITY.md).
