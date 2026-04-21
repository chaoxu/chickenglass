import { Decoration, type EditorView } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { CSS } from "../constants/css-classes";
import { cursorInRange } from "./node-collection";

const sourceDelimiterDecoration = Decoration.mark({ class: CSS.sourceDelimiter });
const inlineSourceDecoration = Decoration.mark({ class: CSS.inlineSource });

const SOURCE_DELIMITER_MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "HighlightMark",
  "LinkMark",
]);
const INLINE_SOURCE_MARKS = new Set(["URL"]);

export function addInlineRevealSourceMetricsInSubtree(
  node: SyntaxNode,
  items: Range<Decoration>[],
): void {
  let child = node.firstChild;
  while (child) {
    if (SOURCE_DELIMITER_MARKS.has(child.name)) {
      items.push(sourceDelimiterDecoration.range(child.from, child.to));
    }
    if (INLINE_SOURCE_MARKS.has(child.name)) {
      items.push(inlineSourceDecoration.range(child.from, child.to));
    }
    addInlineRevealSourceMetricsInSubtree(child, items);
    child = child.nextSibling;
  }
}

export function sourceRevealMetricsForNode(
  view: EditorView,
  node: SyntaxNode,
): readonly Range<Decoration>[] {
  if (!cursorInRange(view, node.from, node.to)) {
    return [];
  }

  const items: Range<Decoration>[] = [];
  addInlineRevealSourceMetricsInSubtree(node, items);
  return items;
}
