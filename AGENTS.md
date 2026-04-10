# Coflat v2

Semantic document editor for mathematical writing. Runs as a native desktop app
(Tauri) or in the browser for development.

## Shared file

`AGENTS.md` is the canonical shared instructions file for both `AGENTS.md` and
`CLAUDE.md`. Keep them in sync in the same change.

## Repo / tooling assumptions

- This repo is hosted on a local Gitea instance at `http://localhost:3001`; use
  `tea` for issue and PR work.
- Prefix repo-local shell commands with `rtk`.
- Prefer the repo browser helpers before ad hoc CDP scripts.

## Stack

- **Language**: TypeScript (strict mode) + Rust (Tauri backend)
- **Editor**: Lexical
- **Markdown carryover**: Lexical markdown + headless round-trip tests
- **Math**: KaTeX
- **Desktop**: Tauri v2
- **Build**: Vite + Cargo
- **Package manager**: pnpm
- **UI**: @radix-ui/dialog, @dnd-kit, lucide-react, cmdk

## Project structure

```text
src/
  lexical/       # Lexical editor core, markdown bridge, custom nodes, carryover tests
  app/           # React shell, editor session, overlays, file management
  index/         # Markdown indexing/query helpers built from canonical text
  lib/           # Shared utilities and pure helpers
  constants/     # UI/event/storage constants
  debug/         # Runtime/perf/debug capture helpers
demo/            # Public showcase project loaded in browser dev mode
fixtures/        # Regression and heavy-document fixtures
src-tauri/       # Rust backend
scripts/         # Browser harnesses, perf tools, worktree helpers, import tools
```

## Commands

```bash
pnpm install
pnpm dev
pnpm preview
pnpm dev:worktree -- perf-444 --base origin/main --fetch
pnpm build
pnpm lint
pnpm lint:fix
pnpm test
pnpm typecheck
pnpm tauri:dev
pnpm tauri:build
pnpm test:browser
pnpm chrome
```

## Tooling

```bash
pnpm knip
pnpm publint
pnpm size
pnpm build:analyze
cargo nextest run
```

## Debug helpers

Debug globals are exposed on `window` for console and Playwright testing:

```text
__app.openFile("posts/x.md")
__app.openFileWithContent("scratch.md", "# Draft")
__app.saveFile()
__app.closeFile({ discard: true })
__app.setSearchOpen(true)
__app.setMode("lexical")
__app.getMode()
__app.getProjectRoot()
__app.getCurrentDocument()
__app.isDirty()

__editor.focus()
__editor.getDoc()
__editor.getSelection()
__editor.insertText("hello")
__editor.setDoc("# Replaced")
__editor.setSelection(10, 15)

__cfDebug.perfSummary()
__cfDebug.printPerfSummary()
__cfDebug.clearPerf()
__cfDebug.togglePerfPanel()
__cfDebug.toggleFps()

__tauriSmoke.openProject("/abs/path")
__tauriSmoke.openFile("notes.md")
__tauriSmoke.getWindowState()
__tauriSmoke.simulateExternalChange("notes.md")
__tauriSmoke.requestNativeClose()
```

Playwright helpers live in `scripts/test-helpers.mjs`.

## Dev mode

`pnpm dev` runs Vite in dev mode (`import.meta.env.DEV === true`). In dev mode,
dirty-file confirmation is skipped by default.

When asked to start the preview server, prefer `pnpm build && pnpm preview`.
The preview script binds `0.0.0.0` for IPv4 access.

## Browser testing

Prefer the managed Playwright harness for automated verification.

Managed harness:
1. Start `pnpm dev`
2. Run `pnpm test:browser` or `node scripts/perf-regression.mjs ...`
3. Default mode is Playwright-owned Chromium; use `--browser cdp` only when you intentionally want the shared manual lane

Manual CDP lane:
1. Start `pnpm dev`, then `pnpm chrome`
2. Connect with `chromium.connectOverCDP("http://localhost:9322")`
3. Use `page.evaluate()` with `__app`, `__editor`, and `__cfDebug`
4. Use `scripts/test-helpers.mjs` or `node scripts/screenshot.mjs ...` for screenshots

Do not use the Playwright MCP plugin for this repo.

## Perf benchmarking

- Use `scripts/perf-regression.mjs`
- Preferred heavy fixture: `fixtures/cogirth/main2.md`
- Fallback public fixture: `demo/index.md`
- Every perf change must report before/after numbers on a real document

## Conventions

- ES modules only
- `const` over `let`
- No `any`; use `unknown`
- kebab-case files, PascalCase types, camelCase functions
- Export types from their module and re-export from barrels when needed
- One concept per file
- Tests next to source when practical
- Vitest for tests

## Code quality priorities

- No circular dependencies
- No duplicated ownership of the same concept
- Prefer explicit state machines and discriminated unions
- Keep modules small and focused
- If a file is already too large or mixes unrelated concerns, split it before adding more

## Document format

Pandoc-flavored markdown is the canonical document format. See `FORMAT.md`.
All markdown fixtures and examples in this repo must follow `FORMAT.md`.

## Gitea / issue tracking

Use `tea` for issue and PR interactions:

```bash
tea issues
tea issues --state closed
tea issues create --title "..." --description "..."
tea pulls
tea pr create --title "..." --base main --head <branch>
tea logins
```

## Workspace hygiene

- Temporary files go in `/tmp/coflat-*`
- `demo/` is public showcase content only
- Use `fixtures/` for regression, heavy, or private documents
- Prefer `pnpm dev:worktree -- <name>` for isolated local work

## Maintenance triggers

- If a change touches the debug bridge, update `scripts/test-helpers.mjs`,
  `src/types/window.d.ts`, and this file together
- If a change alters markdown semantics, update `FORMAT.md` tests in
  `src/lexical/` and browser carryover coverage together
- If a change touches a large mixed-concern file, explicitly consider extraction

## Development rules & architecture

Reference docs live under `docs/` and are loaded on demand:

- `docs/architecture/development-rules.md`
- `docs/architecture/architecture-decisions.md`
- `docs/architecture/subsystem-pattern.md`
- `docs/design/inline-rendering-policy.md`
- `docs/architecture/theme-contract.md`
