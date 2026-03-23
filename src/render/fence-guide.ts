/**
 * Fenced div nesting guides.
 *
 * Draws vertical lines on the left edge of lines inside fenced divs
 * to indicate nesting depth. Only visible when the cursor is inside
 * a fenced div (editing mode). Each nesting level adds another line,
 * making it easy to see where blocks start and end.
 *
 * Uses a StateField with Decoration.line to add per-line depth classes.
 */

import {
  type DecorationSet,
  Decoration,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  createDecorationsField,
  editorFocusField,
  focusTracker,
} from "./render-utils";

interface FencedDivRange {
  from: number;
  to: number;
}

/** Collect all FencedDiv ranges from the syntax tree. */
function collectFencedDivRanges(state: EditorState): FencedDivRange[] {
  const ranges: FencedDivRange[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FencedDiv") {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });
  return ranges;
}

/** Build fence guide decorations — only for divs containing the cursor. */
function buildFenceGuides(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return Decoration.none;

  const cursor = state.selection.main;
  const allDivs = collectFencedDivRanges(state);

  // Find which FencedDivs contain the cursor
  const activeDivs = allDivs.filter(
    (d) => cursor.from >= d.from && cursor.to <= d.to,
  );

  if (activeDivs.length === 0) return Decoration.none;

  // Common case: single active div — all lines have the same depth.
  // Skip the Map overhead entirely: just walk lines once.
  if (activeDivs.length === 1) {
    const div = activeDivs[0];
    const startLine = state.doc.lineAt(div.from).number;
    const endLine = state.doc.lineAt(div.to).number;
    const items: Range<Decoration>[] = [];
    const deco = Decoration.line({ class: "cf-fence-guide cf-fence-d1" });
    for (let ln = startLine; ln <= endLine; ln++) {
      items.push(deco.range(state.doc.line(ln).from));
    }
    return buildDecorations(items);
  }

  // Multiple nesting levels: sweep-line with depth events at boundaries.
  // Collects +1 at div start line, -1 at div end line + 1, then walks
  // the covered line range once. O(activeDivs + totalLines) vs the
  // previous O(activeDivs * avgLinesPerDiv).
  const events = new Map<number, number>();
  let minLine = Infinity;
  let maxLine = -Infinity;
  for (const div of activeDivs) {
    const startLine = state.doc.lineAt(div.from).number;
    const endLine = state.doc.lineAt(div.to).number;
    events.set(startLine, (events.get(startLine) ?? 0) + 1);
    events.set(endLine + 1, (events.get(endLine + 1) ?? 0) - 1);
    if (startLine < minLine) minLine = startLine;
    if (endLine > maxLine) maxLine = endLine;
  }

  const items: Range<Decoration>[] = [];
  let depth = 0;
  for (let ln = minLine; ln <= maxLine; ln++) {
    const delta = events.get(ln);
    if (delta !== undefined) depth += delta;
    if (depth <= 0) continue;
    const d = Math.min(depth, 6);
    items.push(
      Decoration.line({
        class: `cf-fence-guide cf-fence-d${d}`,
      }).range(state.doc.line(ln).from),
    );
  }

  return buildDecorations(items);
}

const fenceGuideField = createDecorationsField(buildFenceGuides);

/** CM6 extension that draws vertical nesting guides for fenced divs (editing only). */
export const fenceGuidePlugin: Extension = [
  editorFocusField,
  focusTracker,
  fenceGuideField,
];
