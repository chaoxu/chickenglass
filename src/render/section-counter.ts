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
import { buildDecorations } from "./decoration-core";
import { createDecorationsField } from "./decoration-field";
import { documentSemanticsField } from "../state/document-analysis";
import { createChangeChecker } from "../state/change-detection";

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

function sameSectionHeadingTopology(
  before: readonly { readonly level: number; readonly unnumbered: boolean }[],
  after: readonly { readonly level: number; readonly unnumbered: boolean }[],
): boolean {
  if (before.length !== after.length) {
    return false;
  }

  for (let index = 0; index < before.length; index += 1) {
    if (
      before[index].level !== after[index].level ||
      before[index].unnumbered !== after[index].unnumbered
    ) {
      return false;
    }
  }

  return true;
}

const sectionShouldRebuild = createChangeChecker({
  get: (state) => state.field(documentSemanticsField).headings,
  equals: sameSectionHeadingTopology,
});

const sectionNumberField = createDecorationsField(
  buildSectionDecorations,
  sectionShouldRebuild,
  true, // map on docChanged — section numbers depend on heading structure, not text
);

/** CM6 extension that adds hierarchical section numbers to headings. */
export const sectionNumberPlugin: Extension = [documentSemanticsField, sectionNumberField];
