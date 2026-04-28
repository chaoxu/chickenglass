# Editor Surfaces

Coflat has one document format and multiple editor surfaces. The canonical file
format is documented in [FORMAT.md](../FORMAT.md). This document describes how
the application presents and edits that format.

## Surfaces

- **CM6 rich mode** edits the markdown file directly. Markdown source remains
  the live editing state, with rendered widgets layered on top.
- **Lexical mode** edits a rich WYSIWYG document model. Markdown is the load and
  save boundary format, not the source of truth during every keystroke.
- **CM6 source mode** edits raw markdown without rich rendering.

All surfaces must load from and save to the same Pandoc-flavored markdown
format. A document that round-trips through one surface should remain valid for
the others.

## Behavior Contract

Editor surfaces may reveal or hide syntax differently while the user edits, but
they must agree on the document semantics.

Required cross-surface behavior:

- Heading trailing attributes such as `{#id}`, `{-}`, and `{.unnumbered}` are
  syntax for the markdown boundary, not visible prose. Rich surfaces hide them
  when the heading is not being edited.
- Math renders through KaTeX in rich surfaces and serializes back to the
  original supported delimiter form where possible.
- Semantic blocks are authored as Pandoc fenced divs and render as typed blocks
  with labels, counters, titles, and body styling.
- Citations and cross-references share Pandoc citation-like syntax at the
  boundary and render from the semantic index in rich surfaces.
- Tables, figures, equations, headings, and theorem-like blocks must expose the
  same labels and references regardless of editor surface.

## Documentation Ownership

- [FORMAT.md](../FORMAT.md) is only the canonical markdown syntax and Pandoc
  compatibility contract.
- This file owns editor-surface presentation and interaction behavior.
- [DESIGN.md](../DESIGN.md) explains product philosophy and high-level
  architecture.
- [docs/architecture/](architecture/) owns implementation decisions and
  subsystem boundaries.
