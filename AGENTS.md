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
pnpm dev:deps
pnpm devx:status
pnpm verify
pnpm verify:quick
pnpm build
pnpm lint
pnpm lint:fix
pnpm test
pnpm test:related <files>  # run only tests that import these files
pnpm typecheck
pnpm tauri:dev
pnpm tauri:build
pnpm test:browser
pnpm test:browser:list
pnpm test:browser:core
pnpm test:browser:full
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

Debug globals are exposed on `window` for console and Playwright testing.
Methods throw `DebugBridgeError` until their provider connects. Automation
should `await __app.ready` (likewise `__editor.ready`, `__cfDebug.ready`)
rather than polling methods in a retry loop.

```text
await __app.ready
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
__editor.formatSelection({ type: "bold" })

__cfDebug.perfSummary()
__cfDebug.printPerfSummary()
__cfDebug.clearPerf()
__cfDebug.togglePerfPanel()
__cfDebug.toggleFps()
__cfDebug.exportSession({ includeDocument: false })
__cfDebug.clearSession()

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
1. Start `pnpm dev`, or use `pnpm verify` / `pnpm perf:baseline` to start or reuse Vite automatically
2. Run `pnpm test:browser`, `pnpm test:browser:core`, or `node scripts/perf-regression.mjs ...`
3. Default mode is Playwright-owned Chromium; use `--browser cdp` only when you intentionally want the shared manual lane

Manual CDP lane:
1. Start `pnpm dev`, then `pnpm chrome`
2. Connect with `chromium.connectOverCDP("http://localhost:9322")`
3. Use `page.evaluate()` with `__app`, `__editor`, and `__cfDebug`
4. Use `scripts/test-helpers.mjs` or `node scripts/screenshot.mjs ...` for screenshots

Do not use the Playwright MCP plugin for this repo.

### Script purposes

- `scripts/test-regression.mjs` — main `pnpm test:browser` entry; auto-loads
  every file under `scripts/regression-tests/` and runs them against a live
  dev server. Use `pnpm test:browser:list` to list tests and groups.
- `scripts/verify.mjs` (`pnpm verify`) — canonical local verification runner;
  runs typecheck, lint, unit tests, knip, build, and the core browser group,
  starting or reusing Vite as needed.
- `scripts/new-browser-regression.mjs` (`pnpm test:browser:new -- <name>`) —
  scaffolds a browser regression test from templates in
  `scripts/regression-tests/templates/`.
- `scripts/test-chrome.mjs` (`pnpm chrome:test`) — standalone Chromium connect
  probe that verifies the `pnpm chrome` CDP lane is reachable and takes a
  screenshot. Use when diagnosing the manual CDP lane, not as part of the
  regression suite.
- `scripts/smoke-editor-package.mjs` (`pnpm smoke:editor-package`) — packs and
  installs `dist/` into a throwaway consumer project to verify the shipped
  `coflat/editor` export is importable with no relative `src/` leakage. Run
  before cutting an editor-package release.
- `scripts/browser-repro.mjs` — capture/replay/diff CDP session recorder; see
  `docs/verification-workflows.md`.

## Perf benchmarking

- Use `pnpm perf:baseline` and `pnpm perf:check` for the standard workflow, or
  `scripts/perf-regression.mjs` for custom scenarios
- Preferred heavy fixture: `demo/perf-heavy/main.md`
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

## Rich surface architecture

- Preserve render/edit parity. If clicking into a surface changes content,
  token interpretation, typography, or layout, treat that as an architectural
  bug, not a styling bug.
- Do not maintain separate semantic renderers for the inactive and active
  states of the same field. If lazy mounting is needed for performance, the
  inactive path must still use the same formatting model and data as the active
  editor path.
- Floating chrome, popovers, and overlays must be owned by the actual editor
  scroll surface. Do not attach viewport-fixed chrome to `document.body` when
  the editor scrolls inside another container.
- Match the editor primitive to the field semantics:
  captions and titles are inline fields;
  table cells and block bodies are rich block fields;
  block openers, include paths, and similar metadata are source-text fields.
- Do not place block-level nested editors inside inline layout slots. If a
  field must stay on one line, it needs an inline editing surface all the way
  down, not block wrappers styled to look inline.
- Punctuation, separators, and label chrome must have a single owner. Either
  markup owns it or CSS owns it, never both.
- Prefer structural fixes over symptom patches. Avoid one-off CSS/font-size
  compensation, per-token parity hacks, or manual scroll-offset corrections
  when the ownership model is wrong.
- When changing user-visible rich-surface behavior, add browser coverage for:
  inactive vs active parity,
  overlay positioning while scrolling,
  inline caption/title layout,
  and rich token behavior inside nested editors.

## Documentation-first development

- Do not default to custom code before checking whether the behavior is already
  defined by upstream documentation, source, or existing subsystem docs.
- For Lexical work, read the relevant official Lexical docs or upstream source
  guidance before introducing new editor patterns, especially for selection,
  commands, transforms, node lifecycle, and DOM reconciliation behavior.
- Prefer extending an existing documented mechanism over inventing a local
  workaround. If the repo deliberately deviates from upstream guidance, make
  the reason explicit in code comments, issues, or architecture docs.
- When a change depends on framework semantics rather than local business
  rules, treat documentation review as part of the implementation work, not as
  optional background reading.

## Lexical runtime rules

- Lexical `$` helpers such as `$getRoot()`, `$getSelection()`, and
  `$getNodeByKey()` must only run inside `editor.update(...)`,
  `editor.read(...)`, command handlers, node transforms, or other valid
  Lexical execution contexts.
- Prefer Lexical commands for cross-plugin coordination. Do not couple plugins
  through ad hoc DOM coordination when a command boundary would express the
  intent more clearly.
- Prefer node transforms for structural normalization and tree invariants. Do
  not scatter one-off structural repair logic across unrelated React plugins
  when the invariant belongs to the Lexical tree.
- Treat Lexical nodes as immutable snapshots. Do not retain node objects across
  updates; reacquire them from the active editor state when needed.
- Treat Lexical node keys as runtime identities only. Do not use them as
  persisted document identifiers or as stable semantic IDs outside the live
  editor session.
- Every `editor.register*()` subscription must have explicit cleanup ownership.
  Long-lived plugins that add DOM listeners or root listeners must keep setup
  and teardown easy to audit.

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
- `pnpm dev:worktree` links the primary checkout's `node_modules` into managed
  worktrees. If hooks or tools report missing binaries, run `pnpm dev:deps`
  inside the worktree to repair the dependency link.
- `pnpm devx:status` reports branch state, dependency link state, dev server
  reachability, CDP browser reachability, optional fixture availability, and
  the last `pnpm verify` result.
- Clean up stale worktrees with the subcommands:
  - `pnpm dev:worktree list` lists Coflat-managed worktrees (branch, age, merged?)
  - `pnpm dev:worktree remove <name>` removes a worktree and its branch
    (refuses dirty worktrees or unmerged branches; `--force` / `--even-if-unmerged` override)
  - `pnpm dev:worktree prune` prunes stale git metadata and deletes managed
    branches that are merged into `origin/main`; use `--dry-run` first

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
- `docs/architecture/lexical-native-rewrite.md`
- `docs/architecture/subsystem-pattern.md`
- `docs/design/inline-rendering-policy.md`
- `docs/architecture/theme-contract.md`
