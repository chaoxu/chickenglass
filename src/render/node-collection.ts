import { syntaxTree } from "@codemirror/language";
import type { Range, EditorState } from "@codemirror/state";
import type { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { containsRange } from "../lib/range-helpers";
import type { VisibleRange } from "./viewport-diff";

/**
 * Check whether the primary cursor is contained within [from, to].
 *
 * Accepts either an EditorView or EditorState:
 * - EditorView: also checks view.hasFocus (returns false when unfocused)
 * - EditorState: pure position check with no focus guard
 *
 * Uses containment (cursor.from >= from && cursor.to <= to) rather than
 * overlap so that clicking near a widget places the cursor outside the
 * replaced range and keeps the widget rendered.
 */
export function cursorInRange(
  viewOrState: EditorView | EditorState,
  from: number,
  to: number,
): boolean {
  if ("state" in viewOrState) {
    if (!viewOrState.hasFocus) return false;
    const cursor = viewOrState.state.selection.main;
    return containsRange({ from, to }, cursor);
  }
  const cursor = viewOrState.selection.main;
  return containsRange({ from, to }, cursor);
}

/** Result of collecting renderable nodes from the syntax tree. */
export interface RenderableNode {
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Walk the syntax tree and collect nodes matching the given type names.
 * Accepts either an EditorView or EditorState.
 */
export function collectNodes(
  viewOrState: EditorView | EditorState,
  types: ReadonlySet<string>,
): RenderableNode[] {
  const state = "state" in viewOrState ? viewOrState.state : viewOrState;
  const results: RenderableNode[] = [];
  const cursor = syntaxTree(state).cursor();
  do {
    if (types.has(cursor.name)) {
      results.push({ type: cursor.name, from: cursor.from, to: cursor.to });
    }
  } while (cursor.next());
  return results;
}

/**
 * Iterate the syntax tree within visible ranges, skip nodes where the
 * cursor is inside, and call `buildItem` for each remaining match.
 *
 * Consolidates the repeated pattern of:
 *   for (const { from, to } of view.visibleRanges) {
 *     syntaxTree(view.state).iterate({ from, to, enter(node) {
 *       if (nodeTypes.has(node.name)) return;
 *       if (cursorInRange(view, node.from, node.to)) return;
 *       buildItem(node, items);
 *     }});
 *   }
 *
 * Returns the accumulated decoration ranges. The caller can pass them
 * to `buildDecorations()` or `Decoration.set(items, true)`.
 *
 * @param view        The editor view (used for visible ranges and cursor).
 * @param nodeTypes   Set of Lezer node type names to match.
 * @param buildItem   Callback invoked for each matching node outside the cursor.
 *                    Receives the SyntaxNodeRef and the accumulator array.
 *                    Return false to prevent descending into children.
 * @param options     Optional overrides for differential viewport updates:
 *   - ranges: explicit ranges to iterate (defaults to view.visibleRanges).
 *   - skip: predicate returning true for node start positions already
 *     processed in a previous viewport (prevents duplicate decorations
 *     for nodes straddling the old/new boundary).
 */
export function collectNodeRangesExcludingCursor(
  view: EditorView,
  nodeTypes: ReadonlySet<string>,
  // biome-ignore lint/suspicious/noConfusingVoidType: CM6-style callback convention; false means skip, void means continue
  buildItem: (node: SyntaxNodeRef, items: Range<Decoration>[]) => false | void,
  options?: {
    ranges?: readonly VisibleRange[];
    skip?: (nodeFrom: number) => boolean;
  },
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  const ranges = options?.ranges ?? view.visibleRanges;
  const skip = options?.skip;

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!nodeTypes.has(node.name)) return;
        if (cursorInRange(view, node.from, node.to) || skip?.(node.from)) {
          return false;
        }
        return buildItem(node, items);
      },
    });
  }

  return items;
}
