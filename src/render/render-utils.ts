import { type EditorView } from "@codemirror/view";
import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** Check whether the cursor (or any part of a selection) overlaps [from, to]. */
export function cursorInRange(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  for (const range of view.state.selection.ranges) {
    // A collapsed cursor at the boundary counts as inside
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/** Result of collecting renderable nodes from the syntax tree. */
export interface RenderableNode {
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Walk the syntax tree and collect nodes matching the given type names.
 */
export function collectNodes(
  view: EditorView,
  types: ReadonlySet<string>,
): RenderableNode[] {
  const results: RenderableNode[] = [];
  const tree = syntaxTree(view.state);
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
