# LexicalTabIndentationPlugin evaluation

Issue: #67

## What it does

`TabIndentationPlugin` (from `@lexical/react/LexicalTabIndentationPlugin`)
intercepts `KEY_TAB_COMMAND` and dispatches `INDENT_CONTENT_COMMAND` (Tab) or
`OUTDENT_CONTENT_COMMAND` (Shift+Tab) on the selected block elements. It
delegates to `registerTabIndentation` from `@lexical/extension`.

Key props:

- `maxIndent?: number` -- maximum indent level
- `$canIndent?: CanIndentPredicate` -- `(node: ElementNode) => boolean`
  predicate that scopes indentation to specific block types. Defaults to
  `ElementNode.canIndent()` on each node.

## coflat's current state

- **Lists:** `ListPlugin` and `CheckListPlugin` are already mounted.
  `ListNode`/`ListItemNode` from `@lexical/list` are registered. List
  indentation (nesting) is handled natively by the list plugin's own Tab
  key handler.
- **No indent behavior:** coflat does not currently use `INDENT_CONTENT_COMMAND`
  or `OUTDENT_CONTENT_COMMAND` anywhere. There is no existing tab-indentation
  code.
- **Markdown bridge:** The markdown serializer does not persist Lexical's
  indent level. Paragraphs, headings, and block quotes serialize to markdown
  without indentation. Any indent applied via `INDENT_CONTENT_COMMAND` would
  be lost on the next markdown round-trip.
- **Tab key:** Currently Tab inserts a tab character (Lexical default) or is
  handled by list nesting. Tab is also used by the reference typeahead plugin
  for option selection.

## Evaluation

### Positives

- The `$canIndent` predicate allows restricting indent to specific node types.
- The `maxIndent` prop prevents runaway nesting.
- Small, clean plugin with explicit cleanup.

### Blockers

1. **Markdown round-trip destroys indent state.** coflat's document format is
   Pandoc-flavored markdown. Lexical's `__indent` property on `ElementNode`
   is a runtime-only concept with no markdown representation. When the editor
   syncs to markdown and back, all indent levels are lost. This makes tab
   indentation a visual lie: the indent appears while editing but vanishes on
   save/reload.

2. **List indentation already works.** `@lexical/list`'s `ListPlugin` handles
   Tab for list nesting natively, which does persist through the markdown
   bridge (nested lists are represented in markdown). Tab indentation for
   lists via `TabIndentationPlugin` would conflict with or duplicate this.

3. **Accessibility warning from Lexical itself.** The plugin's own JSDoc says:
   *"Generally, we don't recommend using this plugin as it could negatively
   affect accessibility for keyboard users, causing focus to become trapped
   within the editor."* Tab is the standard keyboard navigation key for
   moving between focusable elements. Intercepting it traps keyboard-only
   users inside the editor.

4. **Conflict with typeahead navigation.** The `ReferenceTypeaheadPlugin`
   uses Tab (via `KEY_TAB_COMMAND`) for selecting typeahead options. If
   `TabIndentationPlugin` intercepts Tab at the same priority, it would
   prevent typeahead selection.

5. **No semantic meaning for indented paragraphs in mathematical writing.**
   coflat's document model is semantic markdown. Indented paragraphs have no
   defined semantics in the document format. Block quotes (`> ...`) are the
   correct mechanism for visually indented content.

## Decision: REJECT

Tab indentation is incompatible with coflat's markdown-canonical document model.
Indent state does not survive the markdown round-trip, and list nesting is
already handled by `ListPlugin`. The accessibility concern and typeahead
conflict are additional reasons to avoid this plugin.

If block-level indentation becomes needed in the future, it should be
implemented as a markdown-representable construct (e.g., a custom indentation
node that serializes to a specific markdown pattern) rather than relying on
Lexical's runtime-only `__indent` property.
