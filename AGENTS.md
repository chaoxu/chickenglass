# Coflat v2

Semantic document editor for mathematical writing. Runs as a native desktop app (Tauri) or in the browser for development.

## Shared file

`AGENTS.md` is the canonical shared instructions file for both `AGENTS.md` and `CLAUDE.md`.
Keep them as one source of truth. If the shared guidance changes, update the canonical file and keep the other path synced in the same change.

## Repo / tooling assumptions

- This repo is hosted on a local Gitea instance at `http://localhost:3001`; see the Gitea / issue tracking section below for `tea` usage.
- For terminal agents that support it, prefix repo-local shell commands with `rtk`.
- Prefer repo browser helpers before ad hoc CDP scripts.

## Stack

- **Language**: TypeScript (strict mode) + Rust (Tauri backend)
- **Editor**: CodeMirror 6
- **Parser**: Lezer (`@lezer/markdown` with custom extensions)
- **Math**: KaTeX
- **Desktop**: Tauri v2 (smaller bundles, native webview)
- **Build**: Vite (frontend), Cargo (Rust backend)
- **Package manager**: pnpm
- **UI**: @radix-ui/dialog, @dnd-kit, lucide-react, cmdk

## Project structure

```
src/
  editor/        # CM6 setup, keybindings, theme, debug-helpers
  parser/        # Lezer markdown extensions (fenced-div, math, footnotes, etc.)
  plugins/       # Block plugin system (theorem, proof, definition, embed, etc.)
  render/        # CM6 ViewPlugins for Typora-style rendering
  index/         # Semantic indexer (Lezer tree-based extraction)
  citations/     # BibTeX/CSL citation system
  app/           # React shell (hooks, components, file management)
demo/blog/       # Blog project files (loaded via import.meta.glob)
src-tauri/       # Rust backend (filesystem commands, Tauri config)
scripts/         # CDP test helpers, blog import tools
```

## Commands

```bash
pnpm install         # install dependencies
pnpm dev             # start dev server (Vite) — browser mode with blog demo content
pnpm preview         # serve the production build on 0.0.0.0 for IPv4 access
pnpm dev:worktree -- perf-444 --base origin/main --fetch
                     # create an isolated worktree under .worktrees/ from a committed base ref
pnpm build           # production build (frontend only)
pnpm lint            # Biome lint
pnpm lint:fix        # Biome lint autofix
pnpm test            # run tests (Vitest)
pnpm typecheck       # typecheck only
pnpm tauri:dev       # launch Tauri desktop app
pnpm tauri:build     # build production desktop binary
pnpm chrome          # launch Playwright Chromium with CDP on port 9322
```

## Tooling

```bash
# Dead code / unused exports
pnpm knip                           # find unused files, exports, dependencies

# Standalone package validation
pnpm publint                        # validate package.json exports (run after build:editor)
pnpm size                           # check embed bundle size against limits (run after build:editor)

# Bundle analysis
pnpm build:analyze                  # build editor bundle + open dist/stats.html treemap

# Rust tests (faster than cargo test)
cargo nextest run                   # run all Rust tests in parallel
cargo nextest run --test-threads 4  # with explicit concurrency
```

### What each tool does

- **knip** — detects unused files, exports, and dependencies. Run after refactors. Config: `knip.config.ts`. The expected unused UI component re-exports are component-library noise; focus on unused files and unlisted deps.
- **publint** — validates `package.json` exports point to real built files with correct types. Run after `build:editor` before publishing.
- **size-limit** — enforces bundle size budgets for the standalone editor (`dist/editor.mjs` ≤ 2000 kB, `dist/editor.css` ≤ 100 kB). Config lives in `package.json`.
- **rollup-plugin-visualizer** — generates `dist/stats.html` treemap of what is actually in the bundle. Activated by `pnpm build:analyze`.
- **@testing-library/react** (`renderHook`) — for hook-level tests. Setup file: `src/test-setup.ts`.
- **cargo-nextest** — parallel Rust test runner for the Tauri backend. Faster and cleaner than `cargo test`.

### Hooks (lefthook)

Configured in `lefthook.yml`, installed automatically on `pnpm install` via the `prepare` script.

| Hook | Runs | Commands |
|---|---|---|
| `pre-commit` | on every commit (parallel) | `pnpm lint`, `pnpm typecheck` |
| `pre-push` | on every push | `pnpm test` |

Skip hooks when needed: `git commit --no-verify` / `git push --no-verify`. Only do that intentionally.

### CI (Gitea Actions)

Workflow at `.gitea/workflows/ci.yml`. Runs on push/PR to `main`.

| Job | What it checks |
|---|---|
| `lint` | Biome lint + typecheck + knip |
| `test` | Vitest unit tests |
| `package` | `build:editor` → publint → size-limit |
| `rust` | `cargo nextest run` on the Tauri backend |

## Debug helpers

Debug globals are exposed on `window` for console and Playwright testing:

```
__cmView                     — CM6 EditorView (dispatch, state, focus)
__cmDebug.tree()             — FencedDiv nodes from the Lezer syntax tree
__cmDebug.treeString()       — full syntax tree as readable string
__cmDebug.fences()           — closing fence visibility for all blocks
__cmDebug.line(73)           — DOM state of a specific line
__cmDebug.selection()        — current selection (anchor, head, from, to, line, col)
__cmDebug.history()          — undo/redo depth
__cmDebug.dump()             — combined snapshot (tree + fences + cursor + focus)
__cmDebug.toggleTreeView()   — toggle live Lezer tree panel (@overleaf/codemirror-tree-view)
__app.openFile("posts/x.md") — open any file by path (app's real function)
__app.setMode("source")      — switch editor mode (rich/source/read)
__app.saveFile()             — save current file
__app.getProjectRoot()       — current project root path (or null)
__app.getCurrentDocument()   — current doc {path, name, dirty} (or null)
__app.isDirty()              — whether any open document has unsaved changes
__tauriSmoke.openProject("/abs/path") — dev-only Tauri helper to switch project roots deterministically
__tauriSmoke.getWindowState()         — dev-only Tauri snapshot: project root, current doc, dirty, backend root, watcher root
__tauriSmoke.simulateExternalChange("notes.md") — dev-only Tauri helper to emit a file-changed event
__fencedDivDebug = true      — toggle fenced div parser tracing
```

Playwright helpers: `scripts/test-helpers.mjs` — `connectEditor()`, `openFile()`, `getTreeDivs()`, `checkFences()`, `dump()`, `setCursor()`, `scrollTo()`.

## Dev mode

`pnpm dev` runs Vite in dev mode (`import.meta.env.DEV === true`). Dev mode differences:
- **No dirty-file confirmation** — switching files with unsaved changes skips the `window.confirm` dialog for faster testing. Controlled by `Settings.skipDirtyConfirm` (defaults to `true` in dev, `false` in production).

When asked to start the preview server, prefer `pnpm build && pnpm preview`. The preview script binds `0.0.0.0` so it is reachable over IPv4.

## Browser testing (CDP)

**Only ONE dev server and ONE browser at a time.** Kill previous instances before launching. Use `page.reload()` after code changes — never open new browser instances.

1. Start: `pnpm dev`, then `pnpm chrome` (CDP on port 9322)
2. Connect: `chromium.connectOverCDP("http://localhost:9322")`
3. Use `page.evaluate()` + `__cmView`/`__cmDebug`/`__app`. **Never use `locator.click()` on CM6 content.** Use `__app.openFile()` to open files. Set `page.setDefaultTimeout(10000)`.
4. Screenshots: use the `screenshot()` helper from `scripts/test-helpers.mjs`, or `node scripts/screenshot.mjs [file] --output path.png`. **Do not call `page.screenshot()` directly** — headed Chrome CDP can hang there.
5. Kill: `kill $(lsof -ti:5173 -ti:5174 -ti:5175) 2>/dev/null; pkill -f "launch-chrome" 2>/dev/null`

When launching `Google Chrome for Testing` directly in app mode (for example `open -na ... --args --app=URL`), always pass `--disable-infobars` so the Chrome for Testing warning banner does not cover the app UI.

Do NOT use the Playwright MCP plugin — connect directly via CDP.

### Perf benchmarking

- Use the shared perf harness in `scripts/perf-regression.mjs` and the guidance in `docs/perf-regression.md`.
- `demo/cogirth/main2.md` is the standard heavy fixture for open/edit/scroll performance work.

### Runtime regression debugging

- Prefer `scripts/test-helpers.mjs` helpers such as `waitForDebugBridge()` and `assertEditorHealth()` before writing ad hoc CDP snippets.
- Always target the real localhost app page, not merely “the first page” in the browser context.
- For bug-specific runtime verification, do a general smoke check on `index.md` and also run the affected fixture. Heavy regressions often require `demo/rankdecrease/main.md` or `demo/cogirth/main2.md`.
- For cursor/scroll regressions like `#964`, verify with a real long-document runtime repro. If `page.keyboard.press()` is unreliable in the app-mode CDP lane, it is acceptable to drive CM6 movement inside `page.evaluate()` and document the exact command/script used.

## Conventions

- ES modules (`import`/`export`), not CommonJS
- `const` over `let`; no `any` types (use `unknown`)
- kebab-case files, PascalCase types, camelCase functions
- Export types from their module, re-export from `index.ts` barrel files
- One concept per file; tests next to source (`foo.ts` → `foo.test.ts`)
- Vitest for testing

## Code quality priorities

This codebase values **architectural cleanliness**. When making changes:

- **No circular dependencies.** Modules must form a clean DAG. If an import would create a cycle, fix the layering — don't work around it with barrel file exclusions or lazy imports.
- **No duplication.** If the same logic exists in two places, extract it. Don't copy-paste helpers, tree-walking patterns, or state management idioms across files.
- **One owner per concept.** A state field, a tree traversal, a lifecycle transition — each should have exactly one canonical location. Other modules consume it, not reimplement it.
- **Explicit over implicit.** Prefer explicit state machines over coordinating through scattered refs and effects. Prefer typed discriminated unions over `Record<string, unknown>`. Prefer context or direct imports over prop drilling through intermediate components.
- **Small, focused modules.** Split files that mix unrelated concerns. A 1200-line file doing 6 things should be 6 files doing 1 thing each.

## Document format

Pandoc-flavored markdown: no indented code blocks, `$`/`$$` and `\(\)`/`\[\]` for math, fenced divs (`::: {.class #id} Title`), `[@id]` for cross-refs/citations, equation labels `$$ ... $$ {#eq:foo}`. See `FORMAT.md` for the canonical document-format spec. All markdown files in this repo must follow `FORMAT.md`.

## Gitea / issue tracking

This repo is hosted on a local Gitea instance at `http://localhost:3001`. Use the **`tea`** CLI (not `gh`, not raw curl) for all issue/PR interactions:

```bash
tea issues                             # list open issues (default verb is list)
tea issues --state closed              # list closed issues
tea issues --state closed --limit 30
tea issues create --title "..." --description "..."
tea pulls                              # list pull requests
tea pr create --title "..." --base main --head <branch>
tea logins                             # show configured logins (default: coflat / chaoxu)
```

`tea` is already logged in. The default login points to `http://localhost:3001` as user `chaoxu`.

## Workspace hygiene

- Temporary files go in `/tmp/coflat-*` — never in the project directory.
- For isolated local work, prefer `pnpm dev:worktree -- <name>`.
  - It creates a new branch + worktree under `.worktrees/<sanitized-name>`.
  - It links the repo's `node_modules` into the new worktree when available, so verification commands usually work immediately.
  - It is dirty-tree tolerant: uncommitted changes in the current worktree are NOT copied; only committed history from the chosen base ref is used.
  - `--base origin/main --fetch` refreshes the requested remote base ref before creating the worktree.
  - A custom relative `--path` is resolved from the repo root, not the caller's current subdirectory.

## Performance issue standard

Every performance issue and PR must include a **before/after measurement** on a large real document (`demo/cogirth/main2.md` is the standard fixture). Without numbers the change is unverifiable.

- Run the perf harness: `node scripts/perf-regression.mjs` — or use the relevant `perf.*` span from the in-app telemetry.
- For targeted micro-optimizations (for example a single function), a focused microbenchmark or Vitest perf test is acceptable instead, but must still report both numbers.
- The PR description must include the before and after figures. A PR that claims a perf improvement without measurements will not be merged.
- The fixture `demo/cogirth/main2.md` is the canonical heavy document for local-edit, scroll, and open benchmarks. Use a document with similar characteristics if a different scenario is being measured.

## Maintenance triggers

- **Large file trigger**: if a change touches a file above roughly 600 lines, or a file that already mixes multiple concerns, explicitly evaluate extraction/splitting before adding more logic.
- **Neutral owner rule**: if a selector/type/model is used by more than one subsystem, move it into a neutral owner. Do not let renderers depend on protection/event modules for core document selectors.
- **Debug-bridge sync rule**: if a change touches the browser/debug harness, update `scripts/test-helpers.mjs`, `src/types/window.d.ts`, and this shared file together.

## Development rules & architecture

Detailed rules and architecture decisions are in reference files -- loaded on demand, not always in context:

- **[Development rules](docs/architecture/development-rules.md)** — rigor mode, Typora-style editing, CM6 decorations, Lezer parser rules, testing policy, workflow gates, shell safety. Error handling policy: Never use bare `catch {}` without an explicit reason.
- **[Architecture decisions](docs/architecture/architecture-decisions.md)** — Pandoc-free editing, plugin system, FileSystem abstraction, Lezer-everywhere philosophy, library preferences
- **[Subsystem pattern](docs/architecture/subsystem-pattern.md)** — model/controller/render-adapter seam pattern for non-trivial features. One concept should have one clear owner.
- **[Inline rendering policy](docs/design/inline-rendering-policy.md)** — how inline math, bold, italic rendering works
- **[Theme contract](docs/architecture/theme-contract.md)** — CSS variable contract between editor and theme


## ORC integration

This repo is managed by [orc](http://localhost:3001/orc/orc). Issues with the `ORC` label are picked up automatically by the orc daemon. Do not use labels like `agent`, `working`, `needs-fix`, or `needs-look` — those are deprecated. The single `ORC` label is the only visibility gate.
