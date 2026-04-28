# Coflat

Coflat is a semantic document editor for mathematical writing. It targets papers,
notes, books, and lecture-style documents that need equations, theorem-like
blocks, citations, cross-references, figures, tables, and Pandoc export.

The app has one shared markdown boundary format and multiple editor surfaces:
CM6 rich mode, Lexical WYSIWYG mode, and CM6 source mode.

## Quick Start

```bash
pnpm install
pnpm dev        # browser app at localhost:5173
pnpm tauri:dev  # desktop app
```

Useful verification commands:

```bash
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
```

## Documentation

Start here:

- [FORMAT.md](./FORMAT.md) - canonical Pandoc-flavored markdown format.
- [docs/editor-surfaces.md](./docs/editor-surfaces.md) - CM6, Lexical, and
  source-mode behavior over that format.
- [DESIGN.md](./DESIGN.md) - product philosophy and high-level architecture.
- [docs/getting-started.md](./docs/getting-started.md) - development workflow
  and reading order.
- [docs/feature-inventory.md](./docs/feature-inventory.md) - product surface
  checklist for compatibility and rebuild work.
- [AGENTS.md](./AGENTS.md) - repository commands, conventions, debug helpers,
  and local automation guidance.

Implementation details live under [docs/architecture](./docs/architecture).

## Document Model

Coflat documents are Pandoc-flavored markdown. The format uses Pandoc-native
constructs wherever possible:

- YAML frontmatter for document metadata and editor/export settings.
- Fenced divs for theorem-like blocks, proofs, figures, tables, and custom
  semantic blocks.
- `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` for math.
- pandoc-crossref-style labels such as `{#eq:einstein}`.
- `[@id]` syntax for citations and cross-references.

Pandoc owns export. The editor does not run Pandoc in the live editing loop.

## Editor Surfaces

- **CM6 rich mode** keeps markdown as the live source of truth and renders rich
  widgets over it.
- **Lexical mode** edits a WYSIWYG document model and serializes to markdown at
  load/save boundaries.
- **CM6 source mode** edits the raw markdown.

The app shell, file IO, semantic services, document format, and Tauri backend
are shared across surfaces.

## Stack

- TypeScript, React, Vite
- CodeMirror 6 and Lexical
- Lezer markdown parsing with Coflat extensions
- KaTeX
- Tauri v2 desktop shell
- Rust backend for filesystem/native commands

## Development

The common local loop is:

```bash
pnpm dev
pnpm test:focused -- <test-file>
pnpm check:pre-push
```

For browser-driven checks:

```bash
pnpm dev
pnpm test:browser
```

For a stable manual review server:

```bash
pnpm dev:show
```

See [docs/verification-workflows.md](./docs/verification-workflows.md) for the
full verification map.
