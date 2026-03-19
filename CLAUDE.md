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

## Project structure

```
src/
  editor/        # CodeMirror 6 setup, keybindings, theme
  parser/        # Lezer markdown extensions (fenced divs, math, equation labels)
  plugins/       # Block plugin system + default plugins (theorem, proof, etc.)
  render/        # CM6 ViewPlugins for Typora-style rendering
  index/         # Semantic indexer (cross-refs, citations, search)
  citations/     # BibTeX parser and citation rendering
  app/           # File management, tabs, sidebar, TauriFileSystem
  main.ts        # Entry point (detects Tauri vs browser, picks filesystem)
src-tauri/
  src/main.rs    # Tauri entry point, registers commands
  src/commands.rs # Rust filesystem commands (read/write/list/create/exists)
  tauri.conf.json # Tauri config (window, build, permissions)
  capabilities/  # Tauri v2 permission declarations
```

## Commands

```bash
npm install          # install dependencies
npm run dev          # start dev server (Vite) — browser mode with demo content
npm run build        # production build (frontend only)
npm run lint         # ESLint
npm run lint:fix     # ESLint autofix
npm run test         # run tests
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

## Development rules

- **Copy what works**: Before implementing any non-trivial technique, find and study an existing open-source project that does it well. Clone it, read the source, copy the proven approach exactly. Don't invent from scratch. Only deviate when you have a specific reason the existing approach doesn't fit.
  - For CM6 Typora-style editing:
    - [codemirror-rich-markdoc](https://github.com/segphault/codemirror-rich-markdoc) (cloned at `/tmp/codemirror-rich-markdoc`) — inline Decoration.mark approach
    - [obsidian-codemirror-options](https://github.com/nothingislost/obsidian-codemirror-options) (cloned at `/tmp/obsidian-codemirror-options`) — full feature reference for WYSIWYG markdown
    - [advanced-tables-obsidian](https://github.com/tgrosinger/advanced-tables-obsidian) (cloned at `/tmp/advanced-tables-obsidian`) — interactive table editor with Tab/Enter navigation
    - Copy every feature from obsidian-codemirror-options: token hiding, checkbox rendering, inline images, table formatting, blockquote styling, code highlighting, math preview, container attributes
  - Inline elements (bold, italic, headings): `Decoration.mark` + CSS hiding — source text stays in DOM
  - Block/math widgets: `Decoration.replace` + `ignoreEvent() { return true }` + explicit mousedown handler that dispatches cursor to `sourceFrom`
  - **Never** use `ignoreEvent() { return false }` with custom mousedown handlers — CM6 will also process the event and override cursor placement
- **Use Context7**: Before implementing with any library, use the Context7 MCP tool to fetch up-to-date API documentation. Don't rely on memory — APIs change.
- **Verify in browser**: After implementing features, verify they actually work in the running application by testing with Playwright. Tests passing is necessary but not sufficient. Add visual debug overlays (colored boxes, tooltips with positions) for interactive debugging.
- **Wire features into the app**: Every feature must be connected to the editor entry point, not just exported as unused code. Each task's done criteria should include "feature is visible/functional in the running app."
- **Worker gate protocol**: Subagents cannot use the Agent tool. Workers must use `Skill tool with skill: "simplify"` and `Skill tool with skill: "code-reviewer"` for gates. Workers loop until both are clean before reporting done. Lead rejects any non-`pass` status.
- **Debug with the user**: When behavior bugs are hard to reproduce, add visual debug overlays (colored boxes, cursor position display, range tooltips) so both you and the user can see the same information. Use Playwright's headed browser for shared debugging sessions.

## Key architecture decisions

- **Pandoc-free editing loop**: Pandoc is only for export (PDF/LaTeX). The editor uses Lezer + CM6 + KaTeX directly.
- **Every block is a plugin**: The core knows nothing about "theorem." Plugins register classes, parsers, renderers, and numbering.
- **AST nodes track source positions**: Lezer does this by default. Essential for Typora-style editing and future structural editing (v3).
- **Fenced divs are composite blocks**: Content inside `::: ... :::` is parsed as full markdown by re-entering the markdown parser.
- **Tauri over Electron**: Chose Tauri for ~5MB bundles (vs Electron's ~150MB), native OS webview, and Rust backend. The frontend is identical in both browser and Tauri modes.
- **FileSystem abstraction**: `FileSystem` interface in `file-manager.ts` is implemented by `MemoryFileSystem` (demo/dev) and `TauriFileSystem` (desktop). `main.ts` detects the environment at runtime via `window.__TAURI__`.
- **Dual-mode app**: Tauri app starts with demo content, user can "Open Folder" to switch to real files. Browser dev mode always uses demo content. This keeps development fast (no Rust recompilation for frontend changes).
