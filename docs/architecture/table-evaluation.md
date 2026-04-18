# Evaluation: @lexical/table for coflat tables

**Decision: reject adoption**

## Summary

coflat tables are pandoc-flavored markdown pipe tables with column alignment and
divider-cell round-tripping. @lexical/table is designed for rich WYSIWYG tables
with cell merging, background colors, column widths, and frozen rows/columns.
The two models diverge on every axis that matters for this project. Adopting the
upstream package would require either discarding coflat's markdown fidelity or
maintaining an adapter layer thicker than the current custom code.

## Capability comparison

| Capability | coflat custom | @lexical/table |
|---|---|---|
| Column alignment (`left`/`center`/`right`) | First-class (`__alignments`) | Not supported |
| Divider cell preservation | First-class (`__dividerCells`) | Not supported |
| Markdown round-trip | Lossless via `parseMarkdownTable`/`serializeMarkdownTable` | No markdown bridge; requires custom transformer |
| Header row (`<th>`) | Boolean `__header` per cell | Bitmask `headerState` (ROW/COLUMN/BOTH) |
| Cell merging (colspan/rowspan) | Not supported (not in format) | Supported |
| Cell background color | Not supported | Supported |
| Column widths | Not supported | Supported (`__colWidths`) |
| Row striping | Not supported | Supported |
| Frozen rows/columns | Not supported | Supported |
| Multi-cell selection | Not supported | Supported (`TableSelection`) |
| Tab navigation | Not supported | Supported |
| Insert/delete row/column | Not supported | Supported |
| `isShadowRoot()` | false | true (TableNode and TableCellNode) |
| Node type names | `coflat-table`, `coflat-table-row`, `coflat-table-cell` | `table`, `tablerow`, `tablecell` |
| Nested editor per cell | Via `EmbeddedFieldEditor` in renderer | Content children inside `TableCellNode` |

## Key incompatibilities

### 1. No column alignment concept

@lexical/table has no `__alignments` property or equivalent. Pandoc markdown
tables require per-column alignment for faithful round-tripping. To preserve
this with the upstream nodes, we would need to either:

- Subclass `TableNode` and add `__alignments` (fragile; upstream utility
  functions assume the base class and do not propagate custom properties)
- Store alignment in a sidecar data structure outside the Lexical tree (breaks
  the single-source-of-truth model)

Neither approach is maintainable.

### 2. No divider cell preservation

coflat preserves the raw markdown divider row (`|:---|---:|`) so that
round-tripping does not normalize user formatting. @lexical/table has no concept
of divider cells. This data would need to be stored outside the node hierarchy.

### 3. Shadow root semantics conflict

@lexical/table's `TableNode` and `TableCellNode` return `isShadowRoot() = true`.
Shadow roots create selection boundaries: Lexical treats them as nested editor
roots for selection, keyboard navigation, and copy/paste. This is correct for
a rich WYSIWYG table but conflicts with coflat's architecture where:

- Table cells are native Lexical element subtrees so cursor movement, typing,
  copy/paste, and markdown transforms stay on one editor surface.
- The custom nodes still carry pandoc-specific table metadata directly in the
  Lexical tree.

Enabling shadow-root behavior on the structural nodes would interfere with
the existing embedded-field editing model.

### 4. Markdown transformer mismatch

coflat's `tableBlockTransformer` (in `markdown.ts`) handles import/export
through `parseMarkdownTable` and `serializeMarkdownTable`, which preserve
alignment, divider cells, and escaped pipes. @lexical/table provides no markdown
transformer. We would still need to write a custom transformer, but it would
need to construct upstream `TableNode`/`TableCellNode`/`TableRowNode` instances
with their different constructor signatures and header-state semantics.

### 5. Cell content model difference

@lexical/table expects cell content as direct Lexical children (paragraphs,
text nodes, etc.) inside `TableCellNode`. coflat's `TableCellNode` also holds
Lexical children for the markdown bridge, but the *editing* surface is a
separate `EmbeddedFieldEditor` React component. Adopting upstream nodes would
mean either:

- Using the upstream cell nodes as the editing surface while re-adding
  pandoc-specific alignment and divider preservation.
- Continuing to maintain a custom adapter layer alongside upstream nodes,
  defeating the purpose of adoption.

## What coflat gains from the current approach

- **A small custom surface** across `table-node.ts`, `table-cell-node.ts`,
  `table-row-node.ts`, `table-markdown.ts`, and `table-lexical.ts`. This is
  self-contained and stable.
- **Lossless markdown round-trip** including alignment and divider preservation.
- **Clean separation** between structural Lexical nodes (markdown bridge) and
  rich React rendering (EmbeddedFieldEditor per cell).
- **No upstream coupling** for a subsystem whose requirements diverge from
  upstream assumptions.

## What coflat misses without @lexical/table

- **Multi-cell selection** (`TableSelection`): useful for copy/paste across
  cells. Could be built incrementally if needed.
- **Tab navigation**: straightforward to add as a command handler on the
  existing custom nodes.
- **Structural operations** (insert/delete row/column): needed for issue #57
  (table action menu). These operations are simpler on the coflat model because
  there is no cell merging to account for.
- **Cell merging**: not in the pandoc table format, so not needed.

## Recommendation for issue #57

The table action menu (insert/delete row/column, toggle alignment) should be
built directly on the custom table nodes. The operations are simpler than
@lexical/table's equivalents because coflat tables are always regular grids
with no merged cells. A focused implementation (~100-150 lines) will be less
work than an @lexical/table migration and adapter layer.
