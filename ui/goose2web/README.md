# Goose2 Web

Goose2 Web is the browser-only React frontend for Goose. It connects to a running `goose serve` instance over ACP WebSocket and does not spawn or manage the backend process.

## Getting Started

1. If your shell cannot find `just`, `pnpm`, or `lefthook`, activate Hermit.
   bash/zsh: `source ./bin/activate-hermit`
   fish: `source ./bin/activate-hermit.fish`
2. Install git hooks: `lefthook install`
3. Prepare workspace dependencies: `just setup`
4. Start `goose serve` separately, then start the frontend: `just dev`

For local development with a backend on port 3284:

```bash
GOOSE_SERVER__SECRET_KEY=test ../../target/debug/goose serve --host 127.0.0.1 --port 3284
just dev
```

`just clean` removes `dist` and `node_modules`. Run `just setup` again before `just dev`.

`just setup` installs UI workspace dependencies and builds the SDK package. `just dev` starts Vite only; backend lifecycle is owned outside this browser package.

Run `just` to list available commands, or see [justfile](./justfile) for the full recipe definitions.

## Important Files

- [AGENTS.md](./AGENTS.md) repo conventions and agent guidance
- [justfile](./justfile) local setup, dev, test, and CI commands
- [docs/goose2web-cleanup-plan.md](./docs/goose2web-cleanup-plan.md) browser-boundary cleanup plan
