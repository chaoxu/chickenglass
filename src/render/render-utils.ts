import { type EditorView } from "@codemirror/view";
import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** Check whether any selection range overlaps [from, to] in the given state. */
export function selectionOverlaps(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/** Check whether the cursor (or any part of a selection) overlaps [from, to]. */
export function cursorInRange(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  return selectionOverlaps(view.state, from, to);
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
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (types.has(node.type.name)) {
        results.push({
          type: node.type.name,
          from: node.from,
          to: node.to,
        });
      }
    },
  });
  return results;
}

/**
 * Build a DecorationSet from an array of decoration ranges.
 * Sorts by position before building (RangeSetBuilder requires sorted input).
 */
export function buildDecorations(
  items: ReadonlyArray<Range<Decoration>>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of sorted) {
    builder.add(item.from, item.to, item.value);
  }
  return builder.finish();
}

/** Base class for render widgets. */
export abstract class RenderWidget extends WidgetType {
  abstract toDOM(): HTMLElement;
}
