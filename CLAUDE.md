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
__fencedDivDebug = true      — toggle fenced div parser tracing
```

Playwright helpers: `scripts/test-helpers.mjs` — `connectEditor()`, `openFile()`, `getTreeDivs()`, `checkFences()`, `dump()`, `setCursor()`, `scrollTo()`.

## Browser testing (CDP)

**Only ONE dev server and ONE browser at a time.** Kill previous instances before launching. Use `page.reload()` after code changes — never open new browser instances.

1. Start: `npm run dev`, then `npm run chrome` (CDP on port 9322)
2. Connect: `chromium.connectOverCDP("http://localhost:9322")`
3. Use `page.evaluate()` + `__cmView`/`__cmDebug`/`__app`. **Never use `locator.click()` on CM6 content.** Use `__app.openFile()` to open files. Set `page.setDefaultTimeout(10000)`.
4. Kill: `kill $(lsof -ti:5173 -ti:5174 -ti:5175) 2>/dev/null; pkill -f "launch-chrome" 2>/dev/null`

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

## Development rules

- **Subsystem pattern**:
  - For any non-trivial feature, use the subsystem pattern in `docs/architecture/subsystem-pattern.md`.
  - A complex feature should usually have explicit model, controller, render adapter, side-effect, and invariant-test seams.
  - One concept should have one clear owner. Avoid splitting the same policy across unrelated files.
  - When a new subsystem owner exists, remove stale legacy paths instead of keeping both.
- **Default rigor mode**:
  - Unless the user explicitly asks for a quick patch, brainstorming only, or issue-only investigation, default to rigorous implementation.
  - Start with root-cause analysis, not symptom patching.
  - Prefer the smallest clean fix at the correct architectural layer over local hacks.
  - Check adjacent cases and duplicated code paths, not just the exact repro.
  - Add regression coverage for the bug class when feasible, not only the single example.
  - Run targeted verification before claiming fixed.
  - Do a self-review/simplification pass before commit.
  - If the architecture is wrong, say so and fix that instead of preserving a bad shape.
- **Rigor prompt patterns**:
  - `Be rigorous. Don't stop at the first fix.`
  - `Do root-cause analysis first, then implement.`
  - `Treat this like a refactor, not a patch.`
  - `I care more about correctness than speed.`
  - `Review your own change before committing.`
  - `Add regression tests for the bug class, not just the exact repro.`
  - `Check for adjacent cases and duplicates in the codebase.`
  - `If the architecture is wrong, say so and fix that instead.`
- **Typora-style editing**:
  - Content keeps its natural font when editing (code stays monospace, prose stays serif).
  - Opening fence shows as source when cursor is on it; closing fence is always hidden (zero height, protected by transaction filter, cursor skips via atomicRanges).
  - Rich and Read mode must look the same (same CSS classes/properties).
  - Never hide source the user is editing.
  - **Block headers must behave like headings (CRITICAL — regressed 3+ times):**
    - `Decoration.replace` covers ONLY the fence prefix (`::: {.class}` → `titleFrom`), NOT the title text.
    - The widget shows only the label ("**Theorem 1.**" + separator), not the title.
    - Title text (`titleFrom → titleTo`) stays as normal editable document content.
    - Inline render plugins (math, bold, italic) handle title content naturally — `$x^2$` renders as KaTeX.
    - When cursor is on either fence: fence prefix becomes source (`::: {.theorem}`), but title text stays rendered. Only direct cursor contact on `$x^2$` makes it source.
    - When cursor is off both fences: widget replaces fence prefix with rendered label.
    - NEVER replace the full line (`openFenceFrom → titleTo`) with a single widget — this kills inline rendering in source mode.
    - No-title case: widget replaces `openFenceFrom → openFenceTo` (nothing to split).
- **CM6 decoration rules**:
  - `Decoration.line` for inherited CSS (font-size, line-height). `Decoration.mark` for text-only (font-weight, color).
  - `Decoration.replace` + `ignoreEvent() { return true }` + mousedown handler dispatching to `sourceFrom` for widgets.
  - Never extend `Decoration.replace` over user-editable text — edits get swallowed.
  - Never use `ignoreEvent() { return false }` with custom mousedown handlers.
- **Lezer parser rules**:
  - Prefer Lezer tree walking over regex for markdown/document parsing. If the task is really about document structure, syntax, or block boundaries, use the syntax tree.
  - `endLeaf` callbacks for paragraph interruption (display math after text without blank line).
  - Fenced div composite blocks use a generation counter in the `value` parameter to prevent incremental parser fragment reuse (see `packValue` in fenced-div.ts).
  - Block parsers using `cx.nextLine()` inside a composite must check for `:::` closing fences to avoid crossing composite boundaries (see `isFencedDivClose` in equation-label.ts).
  - Guard `closeFenceNode.from` against out-of-range positions — incomplete trees can have `-1`.
- **Testing**:
  - ALWAYS test before claiming fixed. Use `npm run dev` + `npm run chrome` + `__cmDebug.dump()` to verify. Never ask the user to test unless it's something you literally cannot test (e.g., native OS interactions).
  - Always open `index.md` in the browser to verify rendering. It opens by default on startup. If a feature you changed is not covered by `index.md`, add a test case to it.
  - **Visual changes require browser verification before closing an issue.** Any change that affects CSS, rendering, decorations, themes, or layout MUST be verified in the live browser (via CDP) before closing the issue or claiming it's fixed. If browser verification is not possible, explicitly alert the user that visual verification was not done. Never close a visual issue based only on "build passes" or "tests pass."
  - Test StateFields without a browser: `EditorState.create({extensions}).update({changes}).state.field(myField)`.
  - For parser bugs, write a Vitest test with the exact document content first, then check browser for incremental parsing issues.
- **Shell/CLI text safety**:
  - Do not inline long natural-language text directly in shell commands when it contains quotes, backticks, or `$`.
  - For GitHub comments, commit messages, or other multi-sentence CLI text, prefer stdin, a quoted here-doc, or a temp file (`--body-file`, `--comment-file`) over shell interpolation.
  - Short literal commands can stay inline; human prose should usually go through a file.
- **Error handling policy**:
  - User-initiated operations should throw or return a structured failure so the UI can surface the error.
  - System-level parsing/loading that can degrade safely may return empty/default values, but that fallback should be intentional and documented.
  - Async background tasks that dispatch into CM6 must use a connected-view guard (for example `dispatchIfConnected`) so teardown races become noops instead of noisy exceptions.
  - Never use bare `catch {}` without an explicit reason; at minimum, decide whether the error is expected, should be logged, or should be surfaced.
- **Reviewer/simplifier gate before every commit**: Before `git commit`, ALWAYS launch `pr-review-toolkit:code-reviewer` and `pr-review-toolkit:code-simplifier` in parallel on the diff. Apply findings. Then commit once, clean. Not optional. Subagents use `Skill tool` for the same gates and loop until both pass.
- **Closure gate before every `gh issue close`**: Two PreToolUse hooks enforce this:
  1. `closure-gate.sh` — blocks `gh issue close N` unless `.claude/state/closure-verified-N` exists AND contains valid JSON with `{"verdict": "COMPLETE", "criteria": [...]}`. The marker is consumed on close.
  2. `closure-marker-guard.sh` — blocks any Bash command that touches `closure-verified` files. Markers can only be created via the Write tool by a completeness review agent.
  - The completeness review agent must write the marker with structured JSON after verifying all acceptance criteria in the actual codebase.
  - **After every fix round, re-run the completeness review.** Never close based on fix worker self-reports alone. The review→fix→review loop continues until the review returns COMPLETE or retries are exhausted.
- **Copy what works**: Study existing open-source projects before implementing. Reference repos: [codemirror-rich-markdoc](https://github.com/segphault/codemirror-rich-markdoc), [obsidian-codemirror-options](https://github.com/nothingislost/obsidian-codemirror-options), [advanced-tables-obsidian](https://github.com/tgrosinger/advanced-tables-obsidian).
- **Use Context7**: Fetch up-to-date API docs before implementing with any library.
- **Wire features into the app**: Every feature must be connected to the editor entry point, not just exported.

## Key architecture decisions

- **Pandoc-free editing loop**: Pandoc is only for export. The editor uses Lezer + CM6 + KaTeX directly.
- **Read mode is hidden and deferred**: Read mode is currently disabled in the UI. Do not implement, fix, or test read-mode features until rich mode is complete. Focus all rendering work on rich mode.
- **Read mode = HTML export**: `markdown-to-html.ts` is a standalone Lezer tree walker with no CM6 dependency. Keep it CM6-free — pass data as plain objects (e.g., `BibStore`), not CM6 state fields.
- **Every block is a plugin**: Plugins register via `createStandardPlugin()` factory. Core knows nothing about "theorem."
- **Fenced divs are composite blocks**: Content inside `::: ... :::` is parsed as full markdown by re-entering the parser.
- **FileSystem abstraction**: `MemoryFileSystem` (demo/dev) and `TauriFileSystem` (desktop). Runtime detection via `window.__TAURI__`.
- **Dual-mode app**: Browser dev mode loads blog demo. Tauri app starts with demo, user can "Open Folder" for real files.
- **Math macros cached in StateField**: `mathMacrosField` recomputes only when frontmatter changes.
- **RenderWidget base class**: Default `ignoreEvent() { return true }`, inherited by 7+ widget types.
- **Knuth-Plass must apply to ALL paragraphs**: Never skip math-containing paragraphs. The proper fix is a custom implementation using the Lezer syntax tree, not a DOM-walking library.
- **Markdown structure uses Lezer everywhere**: Treat the Lezer markdown parser as the single source of truth for markdown structure, even outside CM6. Do not add new regex/text parsers for markdown blocks when the syntax tree can answer the question.
- **Includes are markdown, not regex**: Include detection/resolution should be tree-based (Lezer), not regex-based with fence-exclusion side logic.
- **Config/data syntax should use standard parsers**: Frontmatter and `coflat.yaml` should be parsed with a standard YAML library, not a handwritten YAML subset parser and not Lezer. Keep only the minimal frontmatter-boundary extraction logic if needed. See issue `#411`.
- **Keep markdown semantics custom**: Lezer should provide structure, but Coflat's semantics layer (crossrefs, equation labels/numbering, theorem/block semantics, citation behavior) stays custom on top of the tree.
- **AI features must consume structured document data**: Future document QA and AI authoring features should consume a structured document IR derived from Lezer + Coflat semantics, not raw markdown, regex extraction, editor DOM, or ad hoc CM6 view state. The IR should stay plain-data and CM6-free.
- **Do not re-platform read/export markdown lightly**: Do not treat a full `remark`/`rehype` rewrite as a default cleanup. It is a replatforming project, not a routine library swap. Narrow hardening swaps are preferred first.
- **Sanitization should use battle-tested libraries**: Prefer `DOMPurify` (or an equivalent maintained sanitizer) over handwritten HTML sanitizers for CSL/bibliography HTML and similar untrusted markup surfaces.
- **URL safety should use the standard URL parser**: Prefer the standard `URL` API plus an explicit protocol allowlist over string-prefix blocking for `href`/`src` safety checks.
- **Prefer built-in text segmentation**: For writing stats and similar generic text counting, prefer `Intl.Segmenter` over regex/split heuristics when feasible.
- **Prefer modern File/Blob APIs**: Use `file.text()` / `file.arrayBuffer()` instead of `FileReader` where possible. Keep custom logic only for product-specific filename/path/data-URL policy.
- **Prefer standard cross-runtime path helpers**: For generic path manipulation, prefer a maintained cross-runtime path library (for example `pathe`) over ad hoc basename/dirname/normalize code. Keep Coflat-specific project-path policy in a thin wrapper layer.
- **If we adopt a global app-state library, use Zustand**: For a broader persisted app-state cleanup, prefer `zustand` with `persist`. Do not introduce a heavier state library unless there is a clear need for it.
- **For watcher normalization, prefer a watcher library**: If the server-side file watcher is revisited, prefer a maintained watcher layer (for example `chokidar`) over adding more normalization logic on top of raw `fs.watch`.
