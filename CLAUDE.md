# Chickenglass v2

Semantic document editor for mathematical writing. Runs as a native desktop app (Tauri) or in the browser for development.

## Stack

- **Language**: TypeScript (strict mode) + Rust (Tauri backend)
- **Editor**: CodeMirror 6
- **Parser**: Lezer (`@lezer/markdown` with custom extensions)
- **Math**: KaTeX
- **Desktop**: Tauri v2 (replaced Electron — smaller bundles, native webview)
- **Build**: Vite (frontend), Cargo (Rust backend)
- **Package manager**: npm
- **UI libraries**: @radix-ui/dialog (accessible modals), @dnd-kit (drag-and-drop), lucide-react (icons), cmdk (command palette)

## Project structure

```
src/
  editor/        # CodeMirror 6 setup, keybindings, theme (decomposed into 5 sub-modules)
    theme.ts           # Composes sub-modules: base, typography, code, block, margin
    base-theme.ts      # Editor chrome: container, gutters, cursor, selection
    typography-theme.ts # Headings, inline formatting, links, lists
    code-theme.ts      # Code blocks, syntax highlighting
    block-theme.ts     # Fenced divs, tables, embeds, images
    margin-theme.ts    # Math preview, sidenotes, tooltips
    image-paste.ts     # Clipboard image handling
    image-drop.ts      # Drag-and-drop image handling
    image-insert.ts    # File picker image insertion
    image-save.ts      # Shared image utilities (filename gen, alt-text, error logging)
    heading-fold.ts    # Heading fold toggles (uses RenderWidget)
  parser/        # Lezer markdown extensions
    char-utils.ts      # Shared character constants and scanning functions
    highlight.ts       # ==highlight== syntax
    strikethrough.ts   # ~~strikethrough~~ syntax
    fenced-div.ts      # ::: {.class} blocks
    fenced-div-attrs.ts # Attribute parsing for fenced divs
    footnote.ts        # [^ref] footnotes
    equation-label.ts  # $$ ... $$ {#eq:label}
    math-backslash.ts  # \( \) \[ \] delimiters
    frontmatter.ts     # YAML frontmatter parsing
  plugins/       # Block plugin system
    plugin-factory.ts  # createStandardPlugin() factory — theorem-family plugins use this
    plugin-registry.ts # Plugin registration and lookup
    plugin-render.ts   # Block rendering (decomposed into 8 helper functions)
    block-render.ts    # createBlockRender() with className parameter
    theorem-plugin.ts  # Theorem, Lemma, Corollary, Conjecture, Proposition
    definition-plugin.ts
    problem-plugin.ts
    remark-plugin.ts   # Remark, Example
    algorithm-plugin.ts
    proof-plugin.ts    # Proof with QED tombstone
    embed-plugin.ts    # iframe/youtube/gist/generic embeds
    include-resolver.ts # File include resolution
  render/        # CM6 ViewPlugins for Typora-style rendering
    render-utils.ts    # Unified cursorInRange(), RenderWidget base (default ignoreEvent), serializeMacros()
    math-render.ts     # Math rendering (uses shared buildMathItems helper)
    math-macros.ts     # getMathMacros() + mathMacrosField StateField cache
    math-preview.ts    # Math preview panel
    inline-render.ts   # Inline markdown rendering (bold/italic/code hiding)
    code-block-render.ts # Code block widgets
    image-render.ts    # Image rendering
    checkbox-render.ts # Checkbox widgets
    crossref-render.ts # Cross-reference rendering
    markdown-render.ts # General markdown rendering
    table-render.ts    # Table rendering with toolbar
    table-utils.ts     # Table serialization (shared buildSerializedRow helper)
    sidenote-render.ts # Footnote sidenote rendering
    hover-preview.ts   # Hover tooltips (uses CM6 hoverTooltip)
    include-label.ts   # Include region labels (single-pass ViewPlugin)
  index/         # Semantic indexer
    extract.ts         # Lezer tree-based extraction (replaced regex)
    indexer.ts         # BackgroundIndexer (inline, no web worker)
  citations/     # BibTeX/CSL citation system
    bibtex-parser.ts   # BibTeX parsing + shared parseAuthorNames()
    citation-render.ts # Citation formatting
    csl-processor.ts   # CSL processing (typed via citeproc.d.ts)
    citeproc.d.ts      # Type declarations for citeproc library
  app/           # React application shell
    main.tsx           # Entry point (Tauri vs browser detection)
    app.tsx            # Root component (composes hooks)
    demo-blog.ts       # Blog demo files via import.meta.glob
    file-manager.ts    # FileSystem interface, MemoryFileSystem, demo filesystems
    tauri-fs.ts        # TauriFileSystem implementation
    hooks/
      use-editor.ts         # Editor setup (delegates to sub-hooks)
      use-dialogs.ts        # Dialog open/close state management
      use-document-buffer.ts # Tabs, buffers, dirty tracking
      use-file-operations.ts # File CRUD operations
      use-bibliography.ts   # BibTeX/CSL loading
      use-editor-scroll.ts  # Scroll position tracking
      use-menu-events.ts    # Menu event map (Record-based, not switch)
      use-commands.ts       # Command registration
      use-settings.ts       # Settings with shared localStorage utils
    components/
      editor-pane.tsx       # Main editor area
      sidebar.tsx           # File explorer sidebar
      file-tree.tsx         # File tree with inline creation input (no window.prompt)
      tab-bar.tsx           # Tab bar with @dnd-kit drag reordering
      split-pane.tsx        # Resizable split pane (keyboard a11y, ARIA)
      command-palette.tsx   # cmdk-based palette (built-in fuzzy search)
      search-panel.tsx      # Search across indexed content
      sidenote-margin.tsx   # Footnote sidenotes (rAF-throttled scroll)
      breadcrumbs.tsx       # Heading breadcrumbs
      outline.tsx           # Document outline
      settings-dialog.tsx   # @radix-ui/dialog
      shortcuts-dialog.tsx  # @radix-ui/dialog
      goto-line-dialog.tsx  # @radix-ui/dialog
      about-dialog.tsx      # @radix-ui/dialog
    lib/
      utils.ts             # Shared utilities: basename, dirname, uint8ArrayToBase64, localStorage
demo/
  blog/          # Blog project files (loaded via import.meta.glob at build time)
    chickenglass.yaml   # Blog project config (bibliography, math macros)
    reference.bib       # BibTeX references
    bib_style.csl       # CSL citation style
    posts/              # 77 converted blog posts (Hakyll → fenced div format)
    *.md                # Top-level pages (about, research, etc.)
src-tauri/
  src/main.rs    # Tauri entry point
  src/commands.rs # Rust filesystem commands
  tauri.conf.json
  capabilities/  # Tauri v2 permission declarations
```

## Commands

```bash
npm install          # install dependencies
npm run dev          # start dev server (Vite) — browser mode with blog demo content
npm run build        # production build (frontend only)
npm run lint         # ESLint
npm run lint:fix     # ESLint autofix
npm run test         # run tests (Vitest, 824 tests across 39 files)
npx tsc --noEmit     # typecheck only
npm run tauri:dev    # launch Tauri desktop app (starts Vite + Rust backend)
npm run tauri:build  # build production desktop binary
npm run chrome       # launch Playwright Chromium with CDP on port 9322
npm run chrome:test  # connect to running Chrome, take a screenshot
```

## Browser testing (CDP)

Use Playwright's bundled Chromium with a fixed CDP port for browser testing:

1. Start dev server: `npm run dev`
2. Launch Chrome: `npm run chrome` (opens http://localhost:5173, CDP on port 9322)
3. Connect from scripts or tests:
   ```ts
   import { chromium } from "playwright";
   const browser = await chromium.connectOverCDP("http://localhost:9322");
   const page = browser.contexts()[0].pages()[0];
   ```

Do NOT use the Playwright MCP plugin — connect directly via CDP for lower overhead.

## Workspace hygiene

- **Temporary files go in `/tmp/`** — never create temp files, cloned repos, or scratch data in the project directory. Use `/tmp/chickenglass-*` or similar.
- Keep the project root clean — only committed source files, config, and build artifacts belong here.

## Conventions

- Use ES modules (`import`/`export`), not CommonJS
- Prefer `const` over `let`
- No `any` types — use `unknown` if the type is truly unknown
- Name files in kebab-case: `fenced-div.ts`, `theorem-plugin.ts`
- Name types/interfaces in PascalCase: `BlockPlugin`, `FencedDivAttrs`
- Name functions/variables in camelCase: `parseAttributes`, `blockCounter`
- Export types from their module, re-export from `index.ts` barrel files
- One concept per file — don't put the parser and renderer in the same file
- Tests live next to source: `fenced-div.ts` → `fenced-div.test.ts`
- Use Vitest for testing

## Document format

Pandoc-flavored markdown with:
- No indented code blocks (removed from parser)
- Both `$`/`$$` and `\(\)`/`\[\]` for math
- Fenced divs (`::: {.class #id} Title`) for semantic blocks
- `[@id]` for cross-references and citations (resolved by context)
- Equation labels: `$$ ... $$ {#eq:foo}`

See DESIGN.md for full specification.

## Blog content

The `demo/blog/` directory contains 94 files from the user's blog (originally in Hakyll `{Theorem}` syntax, converted to Chickenglass fenced div format). These are loaded as the default demo project in browser mode via Vite's `import.meta.glob`. The converter script is at `/tmp/chickenglass-convert.ts`.

## Development rules

- **Typora-style editing design principles**:
  - **Content keeps its natural font when editing**: code blocks stay monospace, prose stays serif. Never switch fonts when cursor enters/leaves a block.
  - **Show semantic boundaries when editing a block**: when cursor is on a fenced div fence line, show BOTH the opening `:::` and closing `:::` so the user sees the block boundaries. Body content stays rendered.
  - **Rich and Read mode must look the same**: theorem blocks should be italic in both modes, proof blocks normal, etc. Use the same CSS classes/properties.
  - **Never hide source the user is editing**: if cursor is on a line, that line's source syntax must be visible. But don't reveal unrelated source (e.g., don't show closing fence when editing content inside the block).
- **Copy what works**: Before implementing any non-trivial technique, find and study an existing open-source project that does it well. Clone it, read the source, copy the proven approach exactly. Don't invent from scratch. Only deviate when you have a specific reason the existing approach doesn't fit.
  - For CM6 Typora-style editing:
    - [codemirror-rich-markdoc](https://github.com/segphault/codemirror-rich-markdoc) (cloned at `/tmp/codemirror-rich-markdoc`) — inline Decoration.mark approach
    - [obsidian-codemirror-options](https://github.com/nothingislost/obsidian-codemirror-options) (cloned at `/tmp/obsidian-codemirror-options`) — full feature reference for WYSIWYG markdown
    - [advanced-tables-obsidian](https://github.com/tgrosinger/advanced-tables-obsidian) (cloned at `/tmp/advanced-tables-obsidian`) — interactive table editor with Tab/Enter navigation
    - Copy every feature from obsidian-codemirror-options: token hiding, checkbox rendering, inline images, table formatting, blockquote styling, code highlighting, math preview, container attributes
  - Inline elements (bold, italic, headings): `Decoration.mark` + CSS hiding — source text stays in DOM
  - Block/math widgets: `Decoration.replace` + `ignoreEvent() { return true }` + explicit mousedown handler that dispatches cursor to `sourceFrom`
  - **Never** use `ignoreEvent() { return false }` with custom mousedown handlers — CM6 will also process the event and override cursor placement
- **`Decoration.line` vs `Decoration.mark`**: Use `Decoration.line` for CSS properties that should affect ALL children of a line (font-size, line-height) — this is how heading font-size works so math widgets inherit it. Use `Decoration.mark` for text-only properties (font-weight, color). Widgets from `Decoration.replace` are siblings of mark spans, not children, so they can't inherit from marks.
- **Lezer `endLeaf` for paragraph interruption**: Custom block parsers (like `\[` and `$$`) don't interrupt paragraphs by default. Add `endLeaf` callbacks on the `BlockParser` to allow display math after text without a blank line.
- **Use Context7**: Before implementing with any library, use the Context7 MCP tool to fetch up-to-date API documentation. Don't rely on memory — APIs change.
- **ALWAYS test before claiming fixed**: After implementing ANY change, test it yourself in the browser BEFORE telling the user it's fixed. Use `npm run dev` + Playwright headless to verify. Never say "fixed" or "done" without having verified the behavior yourself. If you can't verify (e.g., visual subtlety), say so explicitly.
- **Verify in browser yourself**: After implementing visual or behavioral changes, ALWAYS test yourself using `npm run dev` + Playwright headless (or `npm run chrome` for CDP). Never ask the user to test unless it's something you literally cannot test (e.g., native OS interactions). Use `window.__cmView` to access the CM6 view for programmatic editing/inspection.
- **Browser testing procedure**: Start `npm run dev`, then `npm run chrome`. Connect via `chromium.connectOverCDP('http://localhost:9322')`. Navigate by dispatching cursor positions via `__cmView.dispatch()`, NOT via `locator.click()` which times out on CM6 content. Open specific files by clicking their span in the sidebar file tree. Always set Playwright timeout to 10 seconds: `browser.newPage()` then `page.setDefaultTimeout(10000)`.
- **Never use `locator.click()` on CM6 content** — it always times out because CM6 renders custom widgets, not plain DOM elements. Instead, use `page.evaluate()` to dispatch cursor positions, type via `page.keyboard`, and read state via `window.__cmView`.
- **Debug with visual overlays**: Add visual debug overlays (colored boxes, tooltips with positions) when behavior bugs are hard to reproduce.
- **Wire features into the app**: Every feature must be connected to the editor entry point, not just exported as unused code. Each task's done criteria should include "feature is visible/functional in the running app."
- **Worker gate protocol**: Subagents cannot use the Agent tool. Workers must use `Skill tool with skill: "simplify"` and `Skill tool with skill: "code-reviewer"` for gates. Workers loop until both are clean before reporting done. Lead rejects any non-`pass` status.

## Key architecture decisions

- **Pandoc-free editing loop**: Pandoc is only for export (PDF/LaTeX). The editor uses Lezer + CM6 + KaTeX directly.
- **Read mode = HTML export**: The Read mode renderer (`markdown-to-html.ts`) is a standalone Lezer tree walker with no CM6 dependency. It takes markdown text + options (macros, bibliography) and returns semantic HTML. This same code path is used for both the in-app Read mode view and HTML file export. Keep it CM6-free — data like bibliography entries should be passed as plain objects (e.g., `BibStore`), not read from CM6 state fields.
- **Every block is a plugin**: The core knows nothing about "theorem." Plugins register classes via `createStandardPlugin()` factory. The factory handles title, numbering, counter, and rendering.
- **AST nodes track source positions**: Lezer does this by default. Essential for Typora-style editing and future structural editing (v3).
- **Fenced divs are composite blocks**: Content inside `::: ... :::` is parsed as full markdown by re-entering the markdown parser.
- **Tauri over Electron**: Chose Tauri for ~5MB bundles (vs Electron's ~150MB), native OS webview, and Rust backend. The frontend is identical in both browser and Tauri modes.
- **FileSystem abstraction**: `FileSystem` interface in `file-manager.ts` is implemented by `MemoryFileSystem` (demo/dev) and `TauriFileSystem` (desktop). `main.tsx` detects the environment at runtime via `window.__TAURI__`.
- **Dual-mode app**: Tauri app starts with demo content, user can "Open Folder" to switch to real files. Browser dev mode loads the blog project by default. This keeps development fast (no Rust recompilation for frontend changes).
- **Demo content via import.meta.glob**: Blog files in `demo/blog/` are imported at build time using Vite's `import.meta.glob` with `?raw` query. No code generation step needed.
- **Math macros cached in StateField**: `mathMacrosField` caches parsed macros from frontmatter, recomputing only when frontmatter changes. All math renderers read from this field.
- **Index extraction via Lezer tree**: The indexer walks the Lezer syntax tree directly (no regex). Runs inline on the main thread (web worker removed — serialization overhead exceeded extraction cost for typical documents).
- **RenderWidget base class**: Provides default `ignoreEvent() { return true }` inherited by 7+ widget types. Centralizes cursor-range checking via unified `cursorInRange()`.
- **Shared utilities**: `src/app/lib/utils.ts` contains `basename()`, `dirname()`, `uint8ArrayToBase64()`, `readLocalStorage()`, `writeLocalStorage()` — prevents duplication across modules.
- **Library evaluation pattern**: Libraries are evaluated against actual codebase needs. Rejected: @floating-ui (2 trivial sites), react-resizable-panels (desktop app), fuse.js (cmdk has fuzzy search), path-browserify (only forward slashes). Adopted: @radix-ui/dialog (zero added bundle via cmdk dedup), @dnd-kit (accessibility gains).
- **Knuth-Plass must apply to ALL paragraphs**: Never skip math-containing paragraphs for line breaking. The current tex-linebreak2 library cannot handle KaTeX's DOM (its rendering phase uses `skipWhenRendering` + `display:none` on placeholder elements, causing double-counting). The proper fix is to implement a custom Knuth-Plass that uses the Lezer syntax tree to identify math spans as atomic boxes, not a DOM-walking library. Do not work around the problem by excluding math paragraphs.
