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
import { type Extension, StateEffect } from "@codemirror/state";
import { createBooleanToggleField, createSimpleViewPlugin } from "./render-utils";

/** Effect to toggle focus mode on/off. */
const toggleFocusEffect = StateEffect.define<boolean>();

/** StateField tracking whether focus mode is active. */
const focusModeField = createBooleanToggleField(toggleFocusEffect);

/** Line decoration that dims content. */
const dimmedLine = Decoration.line({ class: "cf-focus-dimmed" });

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

/** Build focus-mode decorations that dim lines outside the current paragraph. */
function buildFocusDecorations(view: EditorView): DecorationSet {
  const active = view.state.field(focusModeField);
  if (!active) return Decoration.none;

  const doc = view.state.doc;
  const cursorPos = view.state.selection.main.head;
  const cursorLine = doc.lineAt(cursorPos).number;
  const { from: paraFrom, to: paraTo } = findParagraphRange(doc, cursorLine);

  const decorations: ReturnType<typeof dimmedLine.range>[] = [];

  for (let i = 1; i <= doc.lines; i++) {
    if (i >= paraFrom && i <= paraTo) continue;
    const line = doc.line(i);
    decorations.push(dimmedLine.range(line.from));
  }

  return Decoration.set(decorations, true);
}

/** Custom update predicate: doc, selection, or toggle state changed. */
function focusShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.startState.field(focusModeField) !==
      update.state.field(focusModeField)
  );
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
  createSimpleViewPlugin(buildFocusDecorations, {
    shouldUpdate: focusShouldUpdate,
  }),
];
