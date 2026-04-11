# LexicalNodeMenuPlugin evaluation

Issue: #62

## What it does

`LexicalNodeMenuPlugin` (from `@lexical/react/LexicalNodeMenuPlugin`) anchors a
menu to a specific Lexical node identified by `NodeKey`. It shares its internals
with `LexicalTypeaheadMenuPlugin` -- both use the same `LexicalMenu` component,
`MenuOption` base class, and `MenuRenderFn` callback.

Key props:

- `nodeKey: NodeKey | null` -- the node to anchor to (menu closes when null)
- `parent?: HTMLElement` -- portal target (defaults to `document.body`)
- `menuRenderFn?: MenuRenderFn<TOption>` -- custom render callback
- `anchorClassName?: string` -- class on the anchor `<div>`
- `onSelectOption`, `options` -- same API as `LexicalTypeaheadMenuPlugin`

## coflat's current approach

coflat already has two floating-UI subsystems:

1. **`SurfaceFloatingPortal`** -- generic surface-owned floating portal using
   `@floating-ui/dom`. Used by `LinkSourcePlugin`, `InlineMathSourcePlugin`,
   `HoverPreviewPlugin`, and `IncludeRegionAffordancePlugin`. Portals into the
   editor scroll surface element, not `document.body`.

2. **`CodeBlockChromePlugin`** -- manually positions overlays relative to the
   scroll surface via `getBoundingClientRect()` math and `createPortal` into the
   surface element.

Both already satisfy the CLAUDE.md rule: *"Floating chrome, popovers, and
overlays must be owned by the actual editor scroll surface."*

## Evaluation

### Positives

- The `parent` prop can attach the menu to the editor surface instead of
  `document.body`, satisfying surface-ownership.
- Shared API with `LexicalTypeaheadMenuPlugin` means the code-block and table
  action menus would use the same pattern as the existing reference typeahead.
- Handles keyboard navigation (arrow keys, enter, escape, tab) out of the box.

### Blockers

1. **Positioning model is incompatible with coflat's surface-owned layout.**
   `LexicalNodeMenuPlugin` positions its anchor `<div>` using
   `containerDiv.style.top = \`${top + anchorHeight + 3 + pageYOffset}px\``
   -- this is viewport-relative math that assumes the anchor is in a
   non-scrolling, document-level coordinate system. When `parent` is the editor
   scroll surface (which scrolls independently), positions are wrong on scroll.
   coflat's `SurfaceFloatingPortal` solves this with `@floating-ui/dom`'s
   `autoUpdate` + absolute positioning relative to the scroll container.

2. **No `@floating-ui/dom` integration.** The plugin uses manual pixel math
   with `getBoundingClientRect()` and `pageYOffset`. coflat already uses
   `@floating-ui/dom` for all floating UI, which handles flip, shift, scroll
   containers, and zoom correctly. Adopting `LexicalNodeMenuPlugin` would
   introduce a parallel, less capable positioning system.

3. **Hardcoded DOM id `typeahead-menu`.** The internal `scrollIntoViewIfNeeded`
   function does `document.getElementById('typeahead-menu')`, which only works
   for one menu at a time and couples to a global DOM id.

4. **No node type filtering.** The plugin anchors to any node by key. For
   table action menus or code-block menus, coflat needs to anchor to specific
   DOM elements within the node's decorator, not to the node's top-level DOM
   element. `LexicalNodeMenuPlugin` provides `editor.getElementByKey(nodeKey)`,
   which returns the node's outer wrapper -- not the specific sub-element
   (e.g., the table header cell or the code-block language badge).

5. **coflat already has the pattern.** `SurfaceFloatingPortal` +
   `useEditorScrollSurface` already provide surface-owned floating UI with
   `@floating-ui/dom` positioning. Adding `LexicalNodeMenuPlugin` would
   duplicate this capability with a less flexible implementation.

## Decision: REJECT

The plugin's positioning model (`pageYOffset`-based, viewport-relative) is
fundamentally incompatible with coflat's surface-owned scroll architecture.
coflat's existing `SurfaceFloatingPortal` already solves this correctly.

For node-anchored menus (code-block chrome, table action menus), continue using
`SurfaceFloatingPortal` with the specific anchor element, not
`LexicalNodeMenuPlugin`.

The shared keyboard-navigation and option-selection logic from `MenuOption` is
already used via `LexicalTypeaheadMenuPlugin` in `ReferenceTypeaheadPlugin`.
If a future menu needs the same keyboard behavior without typeahead, extract the
keyboard-navigation pattern from the existing reference typeahead rather than
pulling in `LexicalNodeMenuPlugin` with its incompatible positioning.
