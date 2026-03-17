/**
 * Heading-based folding for the editor.
 *
 * Collapses everything under a heading until the next heading of
 * equal or higher level. Fold toggles appear inline next to headings
 * (not in a separate gutter column).
 */

import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from "@codemirror/view";
import {
  foldService,
  foldKeymap,
  foldEffect,
  unfoldEffect,
  foldedRanges,
  syntaxTree,
  toggleFold,
} from "@codemirror/language";
import { buildDecorations } from "../render/render-utils";

/** Extract heading level (1–6) from a node name, or 0 if not a heading. */
function headingLevel(name: string): number {
  const m = /^ATXHeading(\d)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * Fold service that defines foldable ranges for ATX headings.
 *
 * For a heading at level N, the fold range extends from the end of the
 * heading line to just before the next heading of level <= N (or end of doc).
 */
const headingFoldService = foldService.of((state, lineStart, _lineEnd) => {
  const tree = syntaxTree(state);
  let headingNode: { from: number; to: number; level: number } | null = null;

  tree.iterate({
    from: lineStart,
    to: lineStart + 1,
    enter(node) {
      const level = headingLevel(node.name);
      if (level > 0 && node.from === lineStart) {
        headingNode = { from: node.from, to: node.to, level };
      }
    },
  });

  if (!headingNode) return null;
  const { level, to: headingEnd } = headingNode;

  const line = state.doc.lineAt(headingEnd);
  let foldEnd = state.doc.length;

  tree.iterate({
    from: line.to + 1,
    enter(node) {
      const nl = headingLevel(node.name);
      if (nl > 0 && nl <= level) {
        const prevLine = state.doc.lineAt(node.from);
        foldEnd = prevLine.from > 0 ? prevLine.from - 1 : prevLine.from;
        return false;
      }
    },
  });

  if (foldEnd <= line.to) return null;
  return { from: line.to, to: foldEnd };
});

/** Widget that renders a fold/unfold toggle inline with a heading. */
class FoldToggleWidget extends WidgetType {
  constructor(
    private readonly pos: number,
    private readonly folded: boolean,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cg-fold-toggle";
    span.textContent = this.folded ? "▶" : "▼";
    span.title = this.folded ? "Unfold section" : "Fold section";

    const pos = this.pos;
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Move cursor to the heading line, then toggle fold
      view.dispatch({ selection: { anchor: pos } });
      toggleFold(view);
    });

    return span;
  }

  eq(other: FoldToggleWidget): boolean {
    return this.pos === other.pos && this.folded === other.folded;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Build fold toggle decorations for all foldable headings. */
function buildFoldToggles(state: EditorState): DecorationSet {
  const tree = syntaxTree(state);
  const items: Range<Decoration>[] = [];
  const folded = foldedRanges(state);

  tree.iterate({
    enter(node) {
      const level = headingLevel(node.name);
      if (level === 0) return;

      const line = state.doc.lineAt(node.from);
      // Check if this heading has a foldable range
      let foldEnd = state.doc.length;
      let hasFoldRange = false;

      tree.iterate({
        from: line.to + 1,
        enter(n) {
          const nl = headingLevel(n.name);
          if (nl > 0 && nl <= level) {
            const prevLine = state.doc.lineAt(n.from);
            foldEnd = prevLine.from > 0 ? prevLine.from - 1 : prevLine.from;
            return false;
          }
        },
      });

      hasFoldRange = foldEnd > line.to;
      if (!hasFoldRange) return;

      // Check if currently folded
      let isFolded = false;
      folded.between(line.to, line.to + 1, () => {
        isFolded = true;
      });

      const widget = new FoldToggleWidget(node.from, isFolded);
      // Line class for position:relative context
      items.push(
        Decoration.line({ class: "cg-fold-line" }).range(node.from),
      );
      items.push(
        Decoration.widget({ widget, side: -1 }).range(node.from),
      );
    },
  });

  return buildDecorations(items);
}

const foldToggleField = StateField.define<DecorationSet>({
  create(state) {
    return buildFoldToggles(state);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect))
    ) {
      return buildFoldToggles(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension for heading-based folding with inline toggles. */
export const headingFold: Extension = [
  headingFoldService,
  foldToggleField,
  keymap.of(foldKeymap),
];
