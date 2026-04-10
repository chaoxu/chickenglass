# Getting Started

## Quick start

```bash
pnpm install
pnpm dev
pnpm tauri:dev
```

## Reading order

1. [DESIGN.md](../DESIGN.md)
2. [AGENTS.md](../AGENTS.md)
3. [FORMAT.md](../FORMAT.md)

## Architecture docs

- [Architecture decisions](architecture/architecture-decisions.md) — Lexical-native editing and markdown ownership
- [Development rules](architecture/development-rules.md) — testing gates, shell rules, and editor constraints
- [Subsystem pattern](architecture/subsystem-pattern.md) — ownership boundaries for non-trivial features
- [Theme contract](architecture/theme-contract.md) — token groups and surface responsibilities
- [Inline rendering policy](design/inline-rendering-policy.md) — inline math and formatting behavior

## Key concepts

- Lexical owns the editor state and interactive editing surface.
- Canonical document state is markdown text that must round-trip through `FORMAT.md`.
- `src/lexical/` owns markdown import/export plus carryover tests.
- `src/index/` and `src/app/markdown/` derive analysis from canonical text, not from a separate editor-only parser tree.

## Development workflow

```bash
pnpm dev
pnpm test:watch
pnpm test:changed
pnpm typecheck:watch
pnpm lint:fix
```

## Browser testing

```bash
pnpm dev
pnpm test:browser
```

For manual visual debugging:

```bash
pnpm dev
pnpm chrome
```

Use `window.__app`, `window.__editor`, and `window.__cfDebug` in the browser console. See `AGENTS.md` for the full debug API.
