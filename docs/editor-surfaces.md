# Editor Surfaces

Coflat has one document format and one editor surface (CodeMirror 6). The
canonical file format is documented in [FORMAT.md](../FORMAT.md). This
document describes how the application presents and edits that format.

## Modes

The CM6 surface runs in two modes:

- **`cm6-rich`** edits the markdown file directly. Markdown source remains the
  live editing state, with rendered widgets layered on top.
- **`source`** edits raw markdown without rich rendering.

Mode switches preserve content and cursor position.

## Behavior Contract

The editor may reveal or hide syntax differently between modes, but the
document semantics are fixed by the markdown source.

- Heading trailing attributes such as `{#id}`, `{-}`, and `{.unnumbered}` are
  syntax for the markdown boundary, not visible prose. Rich mode hides them
  when the heading is not being edited.
- Math renders through KaTeX in rich mode and serializes back to the original
  supported delimiter form.
- Semantic blocks are authored as Pandoc fenced divs and render as typed
  blocks with labels, counters, titles, and body styling.
- Citations and cross-references share Pandoc citation-like syntax at the
  boundary and render from the semantic index in rich mode.
- Tables, figures, equations, headings, and theorem-like blocks expose the
  same labels and references regardless of mode.

## Documentation Ownership

- [FORMAT.md](../FORMAT.md) is the canonical markdown syntax and Pandoc
  compatibility contract.
- This file owns editor presentation and interaction behavior.
- [DESIGN.md](../DESIGN.md) explains product philosophy and high-level
  architecture.
- [docs/architecture/](architecture/) owns implementation decisions and
  subsystem boundaries.
