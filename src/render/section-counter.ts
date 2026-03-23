/**
 * Section numbering for ATX headings.
 *
 * Walks the syntax tree, assigns hierarchical numbers (1, 1.1, 1.2, 2, …),
 * and provides Decoration.line decorations that render the number via
 * CSS ::before.  Numbers are hidden when the cursor is inside the heading.
 *
 * Uses a StateField so that Decoration.line is permitted by CM6.
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
import { buildDecorations, createDecorationsField } from "./render-utils";
import { documentSemanticsField } from "../semantics/codemirror-source";

/** Build section-number decorations for all headings in the document. */
export function buildSectionDecorations(state: EditorState): DecorationSet {
  const items: Range<Decoration>[] = [];
  for (const heading of state.field(documentSemanticsField).headings) {
    if (!heading.number) continue;
    items.push(
      Decoration.line({
        attributes: { "data-section-number": heading.number },
      }).range(heading.from),
    );
  }

  return buildDecorations(items);
}

const sectionNumberField = createDecorationsField(
  buildSectionDecorations,
  (tr) =>
    tr.docChanged ||
    tr.state.field(documentSemanticsField) !== tr.startState.field(documentSemanticsField),
);

/** CM6 extension that adds hierarchical section numbers to headings. */
export const sectionNumberPlugin: Extension = [documentSemanticsField, sectionNumberField];
