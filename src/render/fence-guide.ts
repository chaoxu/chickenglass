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

  // Compute depth per line: count how many active divs contain each line
  const lineDepths = new Map<number, number>();
  for (const div of activeDivs) {
    const startLine = state.doc.lineAt(div.from).number;
    const endLine = state.doc.lineAt(div.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      lineDepths.set(ln, (lineDepths.get(ln) ?? 0) + 1);
    }
  }

  const items: Range<Decoration>[] = [];
  for (const [lineNum, depth] of lineDepths) {
    if (depth <= 0) continue;
    const line = state.doc.line(lineNum);
    const d = Math.min(depth, 6);
    items.push(
      Decoration.line({
        class: `cf-fence-guide cf-fence-d${d}`,
      }).range(line.from),
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
