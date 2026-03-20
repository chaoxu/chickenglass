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
import {
  buildDecorations,
} from "./render-utils";
import { unnumberedRe } from "../app/heading-ancestry";

/** Extract the heading level (1–6) from an ATXHeading node name. */
function headingLevel(name: string): number {
  const m = /^ATXHeading(\d)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/** Build section-number decorations for all headings in the document. */
export function buildSectionDecorations(state: EditorState): DecorationSet {
  const tree = syntaxTree(state);
  const items: Range<Decoration>[] = [];

  // Counters per heading level (index 0 unused, levels 1–6)
  const counters = [0, 0, 0, 0, 0, 0, 0];

  tree.iterate({
    enter(node) {
      const level = headingLevel(node.name);
      if (level === 0) return;

      // Check for Pandoc unnumbered attribute ({-} or {.unnumbered})
      const lineText = state.doc.lineAt(node.from).text;
      if (unnumberedRe.test(lineText)) return;

      // Increment this level, reset all deeper levels
      counters[level]++;
      for (let i = level + 1; i <= 6; i++) counters[i] = 0;

      // Build hierarchical number string: "1.2.3"
      const parts: number[] = [];
      for (let i = 1; i <= level; i++) parts.push(counters[i]);
      const sectionNumber = parts.join(".");

      items.push(
        Decoration.line({
          attributes: { "data-section-number": sectionNumber },
        }).range(node.from),
      );
    },
  });

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
