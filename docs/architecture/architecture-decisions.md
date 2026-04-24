# Key Architecture Decisions

## Core editing

- **Pandoc-free editing loop**: Pandoc is only for export. CM6 edits markdown through Lezer + KaTeX directly. Lexical edits a document model and serializes Pandoc-flavored markdown at the boundary.
- **Editor surfaces are runtime-selected**: Coflat has one app shell, file IO layer, semantics pipeline, format rules, and Tauri backend. Engine-specific behavior belongs behind the CM6 or Lexical editor surfaces, not in duplicated app flows.
- **No in-app read mode**: The app exposes CM6 rich, Lexical WYSIWYG, and source modes. Do not implement, fix, or test a separate read-mode surface.
- **HTML export is Pandoc-owned**: HTML/PDF/LaTeX export goes through the native Pandoc command boundary. In-app hover and chrome previews use the shared rich preview renderer, not a standalone export-style HTML renderer.
- **Every block is a plugin**: Plugins register via `createStandardPlugin()` factory. Core knows nothing about "theorem." Render-specific behavior follows the [Plugin Render Contract](./plugin-render-contract.md).
- **Fenced divs are composite blocks**: Content inside `::: ... :::` is parsed as full markdown by re-entering the parser.

## App architecture

- **FileSystem abstraction**: `MemoryFileSystem` (demo/dev) and `TauriFileSystem` (desktop). Runtime detection via `window.__TAURI_INTERNALS__` (primary) or `globalThis.isTauri` (fallback) — see `src/lib/tauri.ts`.
- **Shared app modes**: Browser dev mode loads demo content. Tauri app starts with demo content and lets the user open real files or folders.
- **Document configuration has neutral owners**: Frontmatter/project config parsing must stay consumable by both editor engines. CM6 may cache derived values in StateFields; shared semantics should not require a CM6 view.
- **CM6 widgets stay in the CM6 layer**: `RenderWidget` and decoration-specific behavior are implementation details of the CM6 editor surface.

## Design philosophy

- **Knuth-Plass must apply to ALL paragraphs**: Never skip math-containing paragraphs. The proper fix is a custom implementation using the Lezer syntax tree, not a DOM-walking library.
- **Markdown structure uses Lezer everywhere**: Treat the Lezer markdown parser as the single source of truth for markdown structure, even outside CM6. Do not add new regex/text parsers for markdown blocks when the syntax tree can answer the question.
- **Config/data syntax should use standard parsers**: Frontmatter and `coflat.yaml` should be parsed with a standard YAML library, not a handwritten YAML subset parser and not Lezer. Keep only the minimal frontmatter-boundary extraction logic if needed. See issue `#411`.
- **Keep markdown semantics custom**: Lezer should provide structure, but Coflat's semantics layer (crossrefs, equation labels/numbering, theorem/block semantics, citation behavior) stays custom on top of the tree.

## Future direction

- **AI features must consume structured document data**: Future document QA and AI authoring features should consume a structured document IR derived from Lezer + Coflat semantics, not raw markdown, regex extraction, editor DOM, or ad hoc CM6 view state. The IR should stay plain-data and CM6-free. See [Document IR](./document-ir.md).
- **Do not re-platform preview markdown lightly**: Do not treat a full `remark`/`rehype` rewrite as a default cleanup for in-app preview surfaces. It is a replatforming project, not a routine library swap. Narrow hardening swaps are preferred first.

## Library preferences

- **Sanitization**: Prefer `DOMPurify` (or equivalent) over handwritten HTML sanitizers for CSL/bibliography HTML and similar untrusted markup.
- **URL safety**: Prefer the standard `URL` API plus an explicit protocol allowlist over string-prefix blocking for `href`/`src` safety checks.
- **Text segmentation**: Prefer `Intl.Segmenter` over regex/split heuristics for writing stats and similar generic text counting.
- **File APIs**: Use `file.text()` / `file.arrayBuffer()` instead of `FileReader` where possible.
- **Path helpers**: Prefer a maintained cross-runtime path library (e.g., `pathe`) over ad hoc basename/dirname/normalize code.
- **App state**: If we adopt a global app-state library, use `zustand` with `persist`.
- **File watcher**: If revisited, prefer a maintained watcher layer (e.g., `chokidar`) over more normalization logic on top of raw `fs.watch`.
