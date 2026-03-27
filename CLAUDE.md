# Coflat v2

Semantic document editor for mathematical writing. Runs as a native desktop app (Tauri) or in the browser for development.

## Stack

- **Language**: TypeScript (strict mode) + Rust (Tauri backend)
- **Editor**: CodeMirror 6
- **Parser**: Lezer (`@lezer/markdown` with custom extensions)
- **Math**: KaTeX
- **Desktop**: Tauri v2 (smaller bundles, native webview)
- **Build**: Vite (frontend), Cargo (Rust backend)
- **Package manager**: npm
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
npm install          # install dependencies
npm run dev          # start dev server (Vite) — browser mode with blog demo content
npm run dev:worktree -- perf-444 --base origin/main --fetch
                     # create an isolated worktree under .worktrees/ from a committed base ref
npm run build        # production build (frontend only)
npm run lint         # ESLint
npm run lint:fix     # ESLint autofix
npm run test         # run tests (Vitest)
npx tsc --noEmit     # typecheck only
npm run tauri:dev    # launch Tauri desktop app
npm run tauri:build  # build production desktop binary
npm run chrome       # launch Playwright Chromium with CDP on port 9322
```

## Debug helpers

Debug globals are exposed on `window` for console and Playwright testing:

```
__cmView                     — CM6 EditorView (dispatch, state, focus)
__cmDebug.tree()             — FencedDiv nodes from the Lezer syntax tree
__cmDebug.treeString()       — full syntax tree as readable string
__cmDebug.fences()           — closing fence visibility for all blocks
__cmDebug.line(73)           — DOM state of a specific line
__cmDebug.dump()             — combined snapshot (tree + fences + cursor + focus)
__cmDebug.toggleTreeView()   — toggle live Lezer tree panel (@overleaf/codemirror-tree-view)
__app.openFile("posts/x.md") — open any file by path (app's real function)
__app.setMode("source")      — switch editor mode (rich/source/read)
__app.saveFile()             — save current file
__tauriSmoke.openProject("/abs/path") — dev-only Tauri helper to switch project roots deterministically
__tauriSmoke.getWindowState()         — dev-only Tauri snapshot: project root, current doc, dirty, backend root, watcher root
__tauriSmoke.simulateExternalChange("notes.md") — dev-only Tauri helper to emit a file-changed event
__fencedDivDebug = true      — toggle fenced div parser tracing
```

Playwright helpers: `scripts/test-helpers.mjs` — `connectEditor()`, `openFile()`, `getTreeDivs()`, `checkFences()`, `dump()`, `setCursor()`, `scrollTo()`.

## Dev mode

`npm run dev` runs Vite in dev mode (`import.meta.env.DEV === true`). Dev mode differences:
- **No dirty-file confirmation** — switching files with unsaved changes skips the `window.confirm` dialog for faster testing. Controlled by `Settings.skipDirtyConfirm` (defaults to `true` in dev, `false` in production).

## Browser testing (CDP)

**Only ONE dev server and ONE browser at a time.** Kill previous instances before launching. Use `page.reload()` after code changes — never open new browser instances.

1. Start: `npm run dev`, then `npm run chrome` (CDP on port 9322)
2. Connect: `chromium.connectOverCDP("http://localhost:9322")`
3. Use `page.evaluate()` + `__cmView`/`__cmDebug`/`__app`. **Never use `locator.click()` on CM6 content.** Use `__app.openFile()` to open files. Set `page.setDefaultTimeout(10000)`.
4. Screenshots: use the `screenshot()` helper from `scripts/test-helpers.mjs`, or `node scripts/screenshot.mjs [file] --output path.png`. **Do not call `page.screenshot()` directly** — Chrome 145's CDP has a headed-mode bug where it hangs indefinitely.
5. Kill: `kill $(lsof -ti:5173 -ti:5174 -ti:5175) 2>/dev/null; pkill -f "launch-chrome" 2>/dev/null`

When launching `Google Chrome for Testing` directly in app mode (for example `open -na ... --args --app=URL`), always pass `--disable-infobars` so the Chrome for Testing warning banner does not cover the app UI.

Do NOT use the Playwright MCP plugin — connect directly via CDP.

## Conventions

- ES modules (`import`/`export`), not CommonJS
- `const` over `let`; no `any` types (use `unknown`)
- kebab-case files, PascalCase types, camelCase functions
- Export types from their module, re-export from `index.ts` barrel files
- One concept per file; tests next to source (`foo.ts` → `foo.test.ts`)
- Vitest for testing

## Document format

Pandoc-flavored markdown: no indented code blocks, `$`/`$$` and `\(\)`/`\[\]` for math, fenced divs (`::: {.class #id} Title`), `[@id]` for cross-refs/citations, equation labels `$$ ... $$ {#eq:foo}`. See `FORMAT.md` for the canonical document-format spec. All markdown files in this repo must follow `FORMAT.md`.

## Workspace hygiene

- Temporary files go in `/tmp/coflat-*` — never in the project directory.
- For isolated local work, prefer `npm run dev:worktree -- <name>`.
  - It creates a new branch + worktree under `.worktrees/<sanitized-name>`.
  - It links the repo's `node_modules` into the new worktree when available, so verification commands usually work immediately.
  - It is dirty-tree tolerant: uncommitted changes in the current worktree are NOT copied; only committed history from the chosen base ref is used.
  - `--base origin/main --fetch` refreshes the requested remote base ref before creating the worktree.
  - A custom relative `--path` is resolved from the repo root, not the caller's current subdirectory.

## Development rules & architecture

Detailed rules and architecture decisions are in reference files -- loaded on demand, not always in context:

- **[Development rules](docs/architecture/development-rules.md)** — rigor mode, Typora-style editing, CM6 decorations, Lezer parser rules, testing policy, error handling, workflow gates, shell safety
- **[Architecture decisions](docs/architecture/architecture-decisions.md)** — Pandoc-free editing, plugin system, FileSystem abstraction, Lezer-everywhere philosophy, library preferences
- **[Subsystem pattern](docs/architecture/subsystem-pattern.md)** — model/controller/render-adapter seam pattern for non-trivial features
- **[Inline rendering policy](docs/design/inline-rendering-policy.md)** — how inline math, bold, italic rendering works
- **[Theme contract](docs/architecture/theme-contract.md)** — CSS variable contract between editor and theme
