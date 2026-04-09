# Key Architecture Decisions

## Core editing

- **Pandoc-free editing loop**: Pandoc is only for export. The editor uses Lezer + CM6 + KaTeX directly.
- **Read mode is hidden and deferred**: Read mode is currently disabled in the UI. Do not implement, fix, or test read-mode features until rich mode is complete. Focus all rendering work on rich mode.
- **Read mode = HTML export**: `markdown-to-html.ts` is a standalone Lezer tree walker with no CM6 dependency. Keep it CM6-free -- pass data as plain objects (e.g., `BibStore`), not CM6 state fields.
- **Every block is a plugin**: Plugins register via `createStandardPlugin()` factory. Core knows nothing about "theorem."
- **Fenced divs are composite blocks**: Content inside `::: ... :::` is parsed as full markdown by re-entering the parser.

## App architecture

- **FileSystem abstraction**: `MemoryFileSystem` (demo/dev) and `TauriFileSystem` (desktop). Runtime detection via `window.__TAURI_INTERNALS__` (primary) or `globalThis.isTauri` (fallback) — see `src/lib/tauri.ts`.
- **Dual-mode app**: Browser dev mode loads blog demo. Tauri app starts with demo, user can "Open Folder" for real files.
- **Math macros cached in StateField**: `mathMacrosField` recomputes only when frontmatter changes.
- **RenderWidget base class**: Default `ignoreEvent() { return true }`, inherited by 7+ widget types.

## Design philosophy

- **Knuth-Plass must apply to ALL paragraphs**: Never skip math-containing paragraphs. The proper fix is a custom implementation using the Lezer syntax tree, not a DOM-walking library.
- **Markdown structure uses Lezer everywhere**: Treat the Lezer markdown parser as the single source of truth for markdown structure, even outside CM6. Do not add new regex/text parsers for markdown blocks when the syntax tree can answer the question.
- **Includes are markdown, not regex**: Include detection/resolution should be tree-based (Lezer), not regex-based with fence-exclusion side logic.
- **Config/data syntax should use standard parsers**: Frontmatter and `coflat.yaml` should be parsed with a standard YAML library, not a handwritten YAML subset parser and not Lezer. Keep only the minimal frontmatter-boundary extraction logic if needed. See issue `#411`.
- **Keep markdown semantics custom**: Lezer should provide structure, but Coflat's semantics layer (crossrefs, equation labels/numbering, theorem/block semantics, citation behavior) stays custom on top of the tree.

## Future direction

- **AI features must consume structured document data**: Future document QA and AI authoring features should consume a structured document IR derived from Lezer + Coflat semantics, not raw markdown, regex extraction, editor DOM, or ad hoc CM6 view state. The IR should stay plain-data and CM6-free. See [Document IR](./document-ir.md).
- **Do not re-platform read/export markdown lightly**: Do not treat a full `remark`/`rehype` rewrite as a default cleanup. It is a replatforming project, not a routine library swap. Narrow hardening swaps are preferred first.

## Library preferences

- **Sanitization**: Prefer `DOMPurify` (or equivalent) over handwritten HTML sanitizers for CSL/bibliography HTML and similar untrusted markup.
- **URL safety**: Prefer the standard `URL` API plus an explicit protocol allowlist over string-prefix blocking for `href`/`src` safety checks.
- **Text segmentation**: Prefer `Intl.Segmenter` over regex/split heuristics for writing stats and similar generic text counting.
- **File APIs**: Use `file.text()` / `file.arrayBuffer()` instead of `FileReader` where possible.
- **Path helpers**: Prefer a maintained cross-runtime path library (e.g., `pathe`) over ad hoc basename/dirname/normalize code.
- **App state**: If we adopt a global app-state library, use `zustand` with `persist`.
- **File watcher**: If revisited, prefer a maintained watcher layer (e.g., `chokidar`) over more normalization logic on top of raw `fs.watch`.
