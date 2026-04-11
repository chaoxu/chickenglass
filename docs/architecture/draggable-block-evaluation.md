# LexicalDraggableBlockPlugin evaluation

Issue: #68

## What it does

`DraggableBlockPlugin_EXPERIMENTAL` (from
`@lexical/react/LexicalDraggableBlockPlugin`) adds drag-and-drop block
reordering. It shows a drag handle on hover and allows users to drag any
top-level node to a new position.

Key props:

- `anchorElem?: HTMLElement` -- portal target for the drag handle and target
  line (defaults to `document.body`)
- `menuRef: React.RefObject<HTMLElement | null>` -- ref to the drag handle
- `targetLineRef: React.RefObject<HTMLElement | null>` -- ref to the drop
  indicator line
- `menuComponent: ReactNode` -- the drag handle UI
- `targetLineComponent: ReactNode` -- the drop target line UI
- `isOnMenu: (element: HTMLElement) => boolean` -- predicate to identify clicks
  on the drag handle (used to prevent blur)
- `onElementChanged?: (element: HTMLElement | null) => void` -- callback when
  the hovered block changes

## How it works internally

The plugin:
1. Listens to `mousemove` on `anchorElem.parentElement` (the scroller)
2. Binary-searches through `$getRoot().getChildrenKeys()` to find which
   top-level element the cursor is over
3. Positions the drag handle next to that element
4. On drag start, sets `dataTransfer` with the node key
5. On drop, uses `$getNearestNodeFromDOMNode` to find the target node and
   calls `insertBefore`/`insertAfter` to reorder
6. Uses `createPortal` into `anchorElem` for the drag handle and target line

## coflat's current state

- **@dnd-kit** is already installed and used for tab-bar reordering
  (`src/app/components/tab-bar.tsx`). It provides keyboard DnD, screen reader
  announcements, and touch support.
- **Block types:** coflat's top-level nodes include paragraphs, headings,
  `RawBlockNode` (display math, fenced divs, footnote definitions, frontmatter,
  images), `TableNode`, `ListNode`, `QuoteNode`, and `CodeNode`.
- **Decorator blocks:** `RawBlockNode` extends `DecoratorBlockNode`. These
  contain nested editors, inline math, and other complex content.
- **No existing drag-and-drop** for editor blocks.

## Evaluation

### Positives

- The `anchorElem` prop can attach the drag handle to the editor scroll surface,
  satisfying surface-ownership.
- Minimal API surface -- consumer provides the UI components.
- The experimental label suggests Meta is actively iterating on it.

### Blockers

1. **No node type filtering.** The plugin operates on all top-level nodes
   returned by `$getRoot().getChildrenKeys()`. There is no predicate to
   exclude specific node types. In coflat, frontmatter blocks should not be
   draggable (they must remain at the top of the document). Footnote
   definitions have semantic ordering requirements. There is no way to tell
   the plugin "this node is not draggable" or "this node cannot be a drop
   target."

2. **HTML5 drag-and-drop only.** The plugin uses native HTML5 drag events
   (`draggable`, `dragstart`, `dragover`, `drop`). This means:
   - No keyboard drag-and-drop (accessibility gap)
   - No touch support on mobile (HTML5 drag events are not supported on touch
     devices)
   - No screen reader announcements

   coflat already uses `@dnd-kit` for tab reordering, which provides all of
   these. Using HTML5 drag for blocks and `@dnd-kit` for tabs creates an
   inconsistent accessibility story.

3. **Positioning uses hardcoded constants.** The plugin uses `SPACE = 4` and
   `TEXT_BOX_HORIZONTAL_PADDING = 28` for handle positioning. These constants
   assume a specific editor layout. coflat's editor layout uses custom spacing
   that does not match these values, and there is no way to configure them
   without forking the plugin.

4. **Binary search assumes simple top-level layout.** The `getBlockElement`
   function binary-searches through top-level elements by vertical position.
   This assumes all blocks are laid out in a single vertical column with no
   gaps, overlaps, or non-standard positioning. coflat's decorator blocks
   (especially tables with scroll shadows and fenced divs with captions) may
   not satisfy this assumption.

5. **Conflicts with existing decorator interaction.** When a user hovers over
   a `RawBlockNode`'s nested editor to type, the drag handle would appear and
   the block would become draggable. Starting a text selection near the edge
   of a decorator block could accidentally initiate a drag. The plugin has no
   mechanism to suppress the drag handle when the cursor is inside a nested
   editor.

6. **Experimental status.** The function is named
   `DraggableBlockPlugin_EXPERIMENTAL`. The API may change in future Lexical
   releases.

7. **Firefox-specific workarounds.** The source contains multiple
   Firefox-specific focus restoration hacks (`IS_FIREFOX` checks with
   `editor.focus()` calls after drag events). This suggests the HTML5 drag
   interaction has unresolved cross-browser issues.

## Decision: REJECT

The plugin's HTML5-only drag model, lack of node type filtering, and
hardcoded positioning constants make it a poor fit for coflat's semantic
block model and accessibility requirements.

If block drag-and-drop is needed in the future, the recommended approach is
to build it on `@dnd-kit` (already a dependency), which provides:

- Keyboard drag-and-drop with arrow keys
- Touch support
- Screen reader announcements (already configured in `tab-bar.tsx`)
- Full control over which nodes are draggable and which are drop targets
- Integration with the editor scroll surface

A `@dnd-kit`-based implementation would use Lexical commands to read and
update the tree (similar to how `BlockKeyboardAccessPlugin` navigates
between blocks) rather than relying on the plugin's HTML5 drag internals.
