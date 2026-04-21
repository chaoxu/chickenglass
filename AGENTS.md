# Coflats

Semantic document editor for mathematical writing. The app can switch at
runtime between CM6 rich mode, Lexical WYSIWYG mode, and CM6 source mode. The
document format, file IO, semantic services, and Tauri backend are shared.

## Shared file

`AGENTS.md` is the canonical shared instructions file for both `AGENTS.md` and `CLAUDE.md`.
Keep them as one source of truth. If the shared guidance changes, update the canonical file and keep the other path synced in the same change.

## Repo / tooling assumptions

- This repo is hosted on a local Gitea instance at `http://localhost:3001`; see the Gitea / issue tracking section below for `tea` usage.
- For terminal agents that support it, prefix repo-local shell commands with `rtk`.
- Prefer repo browser helpers before ad hoc CDP scripts.

## Stack

- **Language**: TypeScript (strict mode) + Rust (Tauri backend)
- **Editors**: CodeMirror 6 for rich/source markdown editing; Lexical for WYSIWYG editing
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
  lexical/       # Lexical WYSIWYG editor surface and markdown serialization
  parser/        # Lezer markdown extensions (fenced-div, math, footnotes, etc.)
  plugins/       # Block plugin system (theorem, proof, definition, embed, etc.)
  render/        # CM6 ViewPlugins for Typora-style rendering
  index/         # Semantic indexer (Lezer tree-based extraction)
  citations/     # BibTeX/CSL citation system
  app/           # React shell (hooks, components, file management)
demo/            # Public showcase project loaded in browser dev mode
fixtures/        # Private/regression fixtures for heavy docs and script-driven tests
src-tauri/       # Rust backend (filesystem commands, Tauri config)
scripts/         # browser harness, CDP helpers, blog import tools
```

## Commands

```bash
pnpm install         # install dependencies
pnpm dev             # start Coflats dev server (Vite)
pnpm dev:show        # start stable no-HMR dev server on localhost:5173 for demos / shared review
pnpm preview         # serve the production build on 0.0.0.0 for IPv4 access
pnpm dev:worktree -- perf-444 --base origin/main --fetch
                     # create an isolated worktree under .worktrees/ from a committed base ref
pnpm build           # production build (frontend + editor package)
pnpm build:coflats   # alias for pnpm build
pnpm lint            # Biome lint
pnpm lint:fix        # Biome lint autofix
pnpm test            # run tests (Vitest)
pnpm test:focused -- src/render/reference-render.test.ts
                     # automation-safe single-worker render/state verification
pnpm typecheck       # typecheck only
pnpm tauri:dev       # launch Coflats Tauri desktop app
pnpm tauri:build     # build Coflats production desktop app bundle
pnpm tauri:build:dmg # build Coflats macOS DMG installer
pnpm test:browser    # stable managed-browser regression harness
pnpm perf:capture:heavy -- --scenario typing-rich-burst
                     # heavy-doc perf lane with longer open/debug budgets
pnpm chrome          # launch Playwright Chromium with CDP on port 9322 (manual debug lane)
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

Prefer the surface-neutral `__editor` bridge when a helper can work in both
CM6 and Lexical. Use `__cmView` / `__cmDebug` only for CM6-specific rendering,
parser, geometry, and scroll investigations.

```
__cmView                     — CM6 EditorView (dispatch, state, focus)
__cmDebug.tree()             — FencedDiv nodes from the Lezer syntax tree
__cmDebug.treeString()       — full syntax tree as readable string
__cmDebug.fences()           — closing fence visibility for all blocks
__cmDebug.line(73)           — DOM state of a specific line
__cmDebug.selection()        — current selection (anchor, head, from, to, line, col)
__cmDebug.history()          — undo/redo depth
__cmDebug.structure()        — active explicit structure-edit target (or null)
__cmDebug.geometry()         — measured visible-line + shell-surface geometry snapshot
__cmDebug.renderState()      — compact visible rich-render snapshot (raw fenced openers, rendered headers, rich-widget counts)
__cmDebug.motionGuards()     — recent vertical-motion guard events
__cmDebug.dump()             — combined snapshot (tree + fences + cursor + focus)
__cmDebug.activateStructureAtCursor() — open structure editing at the current cursor
__cmDebug.clearStructure()   — clear the active structure-edit target
__cmDebug.clearMotionGuards() — clear recorded vertical-motion guard events
__cmDebug.moveVertically("up") — rich-mode vertical move with reverse-scroll guard
__cmDebug.toggleTreeView()   — toggle live Lezer tree panel (@overleaf/codemirror-tree-view)
__app.openFile("posts/x.md") — open any file by path (app's real function)
__app.setMode("lexical")     — switch editor mode (cm6-rich/lexical/source)
__app.saveFile()             — save current file
__app.getProjectRoot()       — current project root path (or null)
__app.getCurrentDocument()   — current doc {path, name, dirty} (or null)
__app.isDirty()              — whether any open document has unsaved changes
__app.ready                  — resolves after the app debug bridge is connected
__editor.ready               — resolves after the product-neutral editor bridge is connected
__editor.getDoc()            — current document text for CM6 or Lexical
__editor.setDoc(text)        — replace current document text through the active editor
__editor.insertText(text)    — insert text through the active editor
__editor.setSelection(a, f)  — set active editor selection
__editor.formatSelection(detail) — format current selection through the active editor
__cfDebug.ready              — resolves after performance/debug helpers are connected
__cfDebug.toggleFps()        — toggle the status-bar FPS meter
__cfDebug.togglePerfPanel()  — toggle the floating perf debug panel
__cfDebug.renderState()      — proxy to the current visible rich-render snapshot
__cfDebug.recorderStatus()   — debug recorder queue/connectivity/capture-mode snapshot
__cfDebug.captureState("label") — combined selection/render/raw-fence/structure snapshot + recorder event
__cfDebug.interactionLog()   — recent Lexical interaction trace entries
__cfDebug.clearInteractionLog() — clear Lexical interaction trace entries
__cfDebug.exportSession()    — export locally recorded debug session events
__cfDebug.clearSession()     — clear locally recorded debug session events
__tauriSmoke.openProject("/abs/path") — dev-only Tauri helper to switch project roots deterministically
__tauriSmoke.getWindowState()         — dev-only Tauri snapshot: project root, current doc, dirty, backend root, watcher root
__tauriSmoke.simulateExternalChange("notes.md") — dev-only Tauri helper to emit a file-changed event
__fencedDivDebug = true      — toggle fenced div parser tracing
```

Playwright helpers: `scripts/test-helpers.mjs` — `connectEditor()`, `waitForDebugBridge()`, `readEditorText()`, `formatSelection()`, `openFile()`, `getTreeDivs()`, `checkFences()`, `getGeometrySnapshot()`, `getRenderState()`, `captureDebugState()`, `dump()`, `setCursor()`, `jumpToTextAnchor()`, `scrollTo()`.

## Dev mode

`pnpm dev` runs Vite in dev mode (`import.meta.env.DEV === true`). Dev mode differences:
- **No dirty-file confirmation** — switching files with unsaved changes skips the `window.confirm` dialog for faster testing. Controlled by `Settings.skipDirtyConfirm` (defaults to `true` in dev, `false` in production).

When asked to start the preview server, prefer `pnpm build && pnpm preview`. The preview script binds `0.0.0.0` so it is reachable over IPv4.

## Browser testing

Prefer the managed Playwright harness for automated verification. The manual CDP/app-mode lane is still useful for visual debugging, but it is not the default regression path anymore.

Managed harness:
1. Start `pnpm dev`.
2. Run scripts like `pnpm test:browser`, `pnpm test:browser:lexical`, `node scripts/perf-regression.mjs ...`, `node scripts/cursor-scroll-regression.mjs ...`, or `node scripts/browser-repro.mjs capture --fixture index.md --line 40`.
3. Default mode is Playwright-owned Chromium. Use `--browser cdp` only when you intentionally want the manual shared app window.

Manual CDP lane:
1. Start `pnpm dev`, then `pnpm chrome` (CDP on port 9322).
2. Connect: `chromium.connectOverCDP("http://localhost:9322")`
3. Use `page.evaluate()` + `__editor`/`__app` for surface-neutral actions. Use `__cmView`/`__cmDebug` only when investigating the CM6 surface. **Never use `locator.click()` on CM6 content.** Use `__app.openFile()` to open files. Set `page.setDefaultTimeout(10000)`.
4. Screenshots: use the `screenshot()` helper from `scripts/test-helpers.mjs`, or `node scripts/screenshot.mjs [file] --output path.png`. **Do not call `page.screenshot()` directly** — headed Chrome CDP can hang there.
5. Kill: `kill $(lsof -ti:5173 -ti:5174 -ti:5175) 2>/dev/null; pkill -f "launch-chrome" 2>/dev/null`

When launching `Google Chrome for Testing` directly in app mode (for example `open -na ... --args --app=URL`), always pass `--disable-infobars` so the Chrome for Testing warning banner does not cover the app UI.

Do NOT use the Playwright MCP plugin — connect directly via CDP.

### Perf benchmarking

- Use the shared perf harness in `scripts/perf-regression.mjs` and the guidance in `docs/perf-regression.md`.
- For changed-area render/state verification, prefer `pnpm test:focused -- <tests...>` over ad hoc Vitest invocations. It pins Vitest to a single deterministic worker lane and cleans up the child worker process on exit.
- For fixture-heavy perf scenarios, prefer `pnpm perf:capture:heavy -- --scenario typing-rich-burst ...` or `pnpm perf:compare:heavy -- ...`.
- When local private fixtures are available, `fixtures/cogirth/main2.md` is the preferred heavy fixture for open/edit/scroll performance work. Otherwise use `demo/index.md` and note the limitation.

### Runtime regression debugging

- Prefer `scripts/test-helpers.mjs` helpers such as `connectEditor()`, `waitForAppUrl()`, `waitForDebugBridge()`, and `assertEditorHealth()` before writing ad hoc browser snippets.
- Always target the real localhost app page, not merely “the first page” in the browser context.
- For bug-specific runtime verification, do a general smoke check on `index.md`. When local private fixtures are available, also run the affected heavy fixture such as `fixtures/rankdecrease/main.md` or `fixtures/cogirth/main2.md`.
- For cursor/scroll regressions like `#964`, verify with a real long-document runtime repro. Prefer the managed harness first. If `page.keyboard.press()` is unreliable in the manual app-mode CDP lane, it is acceptable to drive CM6 movement inside `page.evaluate()` and document the exact command/script used.
- For rich scroll-jump work, use `rtk proxy node scripts/scroll-jump-lab.mjs --fixture rankdecrease/main.md --url http://localhost:5173 --simulate-wheel --step-px 90 --step-count 24` as the primary investigation probe. It also reports `window.__cfDebug.scrollGuards()` so guard activations are quantified, not guessed.
- If `@codemirror/view` is patched in a worktree, clear that worktree's `node_modules/.vite` cache and restart Vite with `pnpm dev -- --force`; otherwise the browser can keep serving the stale pre-patch bundle.

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
- `demo/` is public showcase content only. Unless a file is intentionally generated for the public showcase, do not put it under `demo/`; use `fixtures/` for regression, heavy, or private documents instead.
- For isolated local work, prefer `pnpm dev:worktree -- <name>`.
  - It creates a new branch + worktree under `.worktrees/<sanitized-name>`.
  - It links the repo's `node_modules` into the new worktree when available, so verification commands usually work immediately.
  - It is dirty-tree tolerant: uncommitted changes in the current worktree are NOT copied; only committed history from the chosen base ref is used.
  - `--base origin/main --fetch` refreshes the requested remote base ref before creating the worktree.
  - A custom relative `--path` is resolved from the repo root, not the caller's current subdirectory.

## Performance issue standard

Every performance issue and PR must include a **before/after measurement** on a large real document. When local private fixtures are available, `fixtures/cogirth/main2.md` is preferred; otherwise use `demo/index.md` and note the limitation. Without numbers the change is unverifiable.

- Run the perf harness: `node scripts/perf-regression.mjs` — or use the relevant `perf.*` span from the in-app telemetry.
- For targeted micro-optimizations (for example a single function), a focused microbenchmark or Vitest perf test is acceptable instead, but must still report both numbers.
- The PR description must include the before and after figures. A PR that claims a perf improvement without measurements will not be merged.
- The local private fixture `fixtures/cogirth/main2.md` is the preferred heavy document for local-edit, scroll, and open benchmarks when available. Otherwise use `demo/index.md` or another documented public fixture and note the limitation.

## Maintenance triggers

- **Large file trigger**: if a change touches a file above roughly 600 lines, or a file that already mixes multiple concerns, explicitly evaluate extraction/splitting before adding more logic.
- **Neutral owner rule**: if a selector/type/model is used by more than one subsystem, move it into a neutral owner. Do not let renderers depend on protection/event modules for core document selectors. See [Subsystem pattern: Neutral owner for cross-subsystem state](docs/architecture/subsystem-pattern.md#neutral-owner-for-cross-subsystem-state).
- **Debug-bridge sync rule**: if a change touches the browser/debug harness, update `scripts/test-helpers.mjs`, `src/types/window.d.ts`, and this shared file together.

## Development rules & architecture

Detailed rules and architecture decisions are in reference files -- loaded on demand, not always in context:

- **[Development rules](docs/architecture/development-rules.md)** — rigor mode, dual-editor ownership, CM6 Typora-style rules, Lezer parser rules, testing policy, workflow gates, shell safety. Error handling policy: Never use bare `catch {}` without an explicit reason.
- **[Architecture decisions](docs/architecture/architecture-decisions.md)** — Pandoc-free editing, plugin system, FileSystem abstraction, Lezer-everywhere philosophy, library preferences
- **[Subsystem pattern](docs/architecture/subsystem-pattern.md)** — model/controller/render-adapter seam pattern for non-trivial features. One concept should have one clear owner.
- **[Inline rendering policy](docs/design/inline-rendering-policy.md)** — how inline math, bold, italic rendering works
- **[Theme contract](docs/architecture/theme-contract.md)** — CSS variable contract between editor and theme
