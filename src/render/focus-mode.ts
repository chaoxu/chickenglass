/**
 * Focus mode — dim all content except the current paragraph/block.
 *
 * Toggle via Cmd+Shift+F. When active, lines outside the current
 * paragraph (contiguous run of non-blank lines containing the cursor)
 * are dimmed to 30% opacity.
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, type Extension, StateEffect } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { createBooleanToggleField } from "./focus-state";
import {
  dirtyRangesFromChanges,
  expandChangeRangeToLines,
  mergeDirtyRanges,
  type DirtyRange,
} from "./incremental-dirty-ranges";
import { createIncrementalDecorationsViewPlugin } from "./view-plugin-factories";

/** Effect to toggle focus mode on/off. */
const toggleFocusEffect = StateEffect.define<boolean>();

/** StateField tracking whether focus mode is active. */
const focusModeField = createBooleanToggleField(toggleFocusEffect);

/** Line decoration that dims content. */
const dimmedLine = Decoration.line({ class: CSS.focusDimmed });

interface ParagraphRange {
  readonly lineFrom: number;
  readonly lineTo: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Find the paragraph block containing the given position.
 *
 * A paragraph is a contiguous run of non-blank lines. Returns the
 * line numbers (1-based) of the first and last lines of the block.
 */
function findParagraphRange(
  doc: { lines: number; line: (n: number) => { text: string; number: number } },
  cursorLine: number,
): { from: number; to: number } {
  const isBlank = (n: number): boolean => {
    if (n < 1 || n > doc.lines) return true;
    return doc.line(n).text.trim() === "";
  };

  // Expand upward from cursor line to find start of paragraph
  let from = cursorLine;
  while (from > 1 && !isBlank(from - 1)) {
    from--;
  }

  // Expand downward from cursor line to find end of paragraph
  let to = cursorLine;
  while (to < doc.lines && !isBlank(to + 1)) {
    to++;
  }

  return { from, to };
}

function getActiveParagraphRange(state: EditorState): ParagraphRange | null {
  if (!state.field(focusModeField)) return null;

  const doc = state.doc;
  const cursorPos = state.selection.main.head;
  const cursorLine = doc.lineAt(cursorPos).number;
  const { from: lineFrom, to: lineTo } = findParagraphRange(doc, cursorLine);
  return {
    lineFrom,
    lineTo,
    from: doc.line(lineFrom).from,
    to: doc.line(lineTo).to,
  };
}

function lineNumbersForRange(
  state: EditorState,
  range: DirtyRange,
): { from: number; to: number } {
  const doc = state.doc;
  const from = Math.max(0, Math.min(range.from, doc.length));
  const to = Math.max(from, Math.min(range.to, doc.length));
  return {
    from: doc.lineAt(from).number,
    to: doc.lineAt(to).number,
  };
}

function collectDimmedLineDecorations(
  state: EditorState,
  ranges: readonly DirtyRange[],
  activeParagraph = getActiveParagraphRange(state),
): ReturnType<typeof dimmedLine.range>[] {
  if (!activeParagraph) return [];

  const decorations: ReturnType<typeof dimmedLine.range>[] = [];
  const seenLineStarts = new Set<number>();

  for (const range of ranges) {
    const lines = lineNumbersForRange(state, range);
    for (let lineNumber = lines.from; lineNumber <= lines.to; lineNumber++) {
      if (
        lineNumber >= activeParagraph.lineFrom &&
        lineNumber <= activeParagraph.lineTo
      ) {
        continue;
      }
      const line = state.doc.line(lineNumber);
      if (seenLineStarts.has(line.from)) continue;
      seenLineStarts.add(line.from);
      decorations.push(dimmedLine.range(line.from));
    }
  }

  return decorations;
}

/** Build focus-mode decorations that dim lines outside the current paragraph. */
function buildFocusDecorations(view: EditorView): DecorationSet {
  if (!view.state.field(focusModeField)) return Decoration.none;
  return Decoration.set(
    collectDimmedLineDecorations(view.state, [{ from: 0, to: view.state.doc.length }]),
    true,
  );
}

function mapRangeThroughChanges(
  update: ViewUpdate,
  range: Pick<ParagraphRange, "from" | "to">,
): DirtyRange {
  const from = update.changes.mapPos(range.from, 1);
  const to = Math.max(from, update.changes.mapPos(range.to, -1));
  return { from, to };
}

function focusShouldRebuild(update: ViewUpdate): boolean {
  return (
    update.startState.field(focusModeField) !== update.state.field(focusModeField) ||
    (!update.docChanged && update.selectionSet)
  );
}

function focusDirtyRanges(update: ViewUpdate): DirtyRange[] {
  const wasActive = update.startState.field(focusModeField);
  const isActive = update.state.field(focusModeField);
  if (!update.docChanged || (!wasActive && !isActive)) {
    return [];
  }

  const dirtyRanges = dirtyRangesFromChanges(
    update.changes,
    (from, to) => expandChangeRangeToLines(update.state.doc, from, to),
  );
  const beforeParagraph = wasActive ? getActiveParagraphRange(update.startState) : null;
  const afterParagraph = isActive ? getActiveParagraphRange(update.state) : null;
  const paragraphRanges: DirtyRange[] = [];

  if (beforeParagraph) {
    paragraphRanges.push(mapRangeThroughChanges(update, beforeParagraph));
  }
  if (afterParagraph) {
    paragraphRanges.push({ from: afterParagraph.from, to: afterParagraph.to });
  }

  return mergeDirtyRanges([...dirtyRanges, ...paragraphRanges]);
}

/** Command that toggles focus mode. */
export function toggleFocusMode(view: EditorView): boolean {
  const current = view.state.field(focusModeField);
  view.dispatch({ effects: toggleFocusEffect.of(!current) });
  return true;
}

/** CM6 extension providing focus mode. */
export const focusModeExtension: Extension = [
  focusModeField,
  createIncrementalDecorationsViewPlugin(buildFocusDecorations, {
    shouldRebuild: focusShouldRebuild,
    incrementalRanges: focusDirtyRanges,
    collectRanges(view, ranges) {
      return collectDimmedLineDecorations(view.state, ranges);
    },
    mapDecorations(decorations, update) {
      return update.docChanged ? decorations.map(update.changes) : decorations;
    },
    spanName: "cm6.focusModeDecorations",
  }),
];
