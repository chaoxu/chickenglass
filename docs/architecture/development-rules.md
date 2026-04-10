# Development Rules

- Never use bare `catch {}` without an explicit reason.
- Keep markdown text as the source of truth; do not invent parallel rich-text-only state.
- Prefer Lexical nodes, commands, and editor-state transforms over ad hoc DOM mutation.
- Any change that touches markdown semantics must update carryover coverage in `src/lexical/`.
- Any change that touches browser automation must update `scripts/test-helpers.mjs`, `src/types/window.d.ts`, and `AGENTS.md` together.
- Run `pnpm typecheck` and `pnpm test` before claiming a fix.
- When user-facing editing behavior changes, also run `pnpm test:browser` or document why it could not be run.
- Study existing libraries before building custom editor infrastructure from scratch.
