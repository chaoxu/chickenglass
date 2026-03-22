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
  EditorView,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { buildDecorations } from "./render-utils";
import { analyzeHeadings } from "../semantics/document";
import { editorStateTextSource } from "../semantics/codemirror-source";

/** Build section-number decorations for all headings in the document. */
export function buildSectionDecorations(state: EditorState): DecorationSet {
  const items: Range<Decoration>[] = [];
  for (const heading of analyzeHeadings(editorStateTextSource(state), syntaxTree(state))) {
    if (!heading.number) continue;
    items.push(
      Decoration.line({
        attributes: { "data-section-number": heading.number },
      }).range(heading.from),
    );
  }

  return buildDecorations(items);
}

const sectionNumberField = StateField.define<DecorationSet>({
  create(state) {
    return buildSectionDecorations(state);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildSectionDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that adds hierarchical section numbers to headings. */
export const sectionNumberPlugin: Extension = sectionNumberField;
