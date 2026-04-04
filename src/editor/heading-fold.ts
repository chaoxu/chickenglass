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
  keymap,
} from "@codemirror/view";
import {
  foldService,
  foldKeymap,
  foldEffect,
  unfoldEffect,
  foldedRanges,
} from "@codemirror/language";
import { buildDecorations, RenderWidget } from "../render/render-core";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";

interface HeadingFoldSection {
  readonly headingFrom: number;
  readonly foldFrom: number;
  readonly foldTo: number;
  readonly level: number;
}

interface HeadingFoldState {
  readonly sections: readonly HeadingFoldSection[];
  readonly sectionByHeadingFrom: ReadonlyMap<number, HeadingFoldSection>;
  readonly decorations: DecorationSet;
}

function buildSectionByHeadingFrom(
  sections: readonly HeadingFoldSection[],
): ReadonlyMap<number, HeadingFoldSection> {
  return new Map(sections.map((section) => [section.headingFrom, section]));
}

function foldToBeforeHeading(state: EditorState, headingFrom: number): number {
  const line = state.doc.lineAt(headingFrom);
  return line.from > 0 ? line.from - 1 : line.from;
}

function buildHeadingFoldSections(
  state: EditorState,
): readonly HeadingFoldSection[] {
  const { headings } = state.field(documentSemanticsField);
  if (headings.length === 0) return [];

  const nextHeadingIndexByLevel: Array<number | undefined> = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const sections: HeadingFoldSection[] = [];

  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    let nextBoundaryIndex: number | undefined;

    for (let level = 1; level <= heading.level; level++) {
      const candidate = nextHeadingIndexByLevel[level];
      if (candidate !== undefined && (
        nextBoundaryIndex === undefined || candidate < nextBoundaryIndex
      )) {
        nextBoundaryIndex = candidate;
      }
    }

    const line = state.doc.lineAt(heading.to);
    const foldFrom = line.to;
    const foldTo = nextBoundaryIndex === undefined
      ? state.doc.length
      : foldToBeforeHeading(state, headings[nextBoundaryIndex].from);

    if (foldTo > foldFrom) {
      sections.push({
        headingFrom: heading.from,
        foldFrom,
        foldTo,
        level: heading.level,
      });
    }

    nextHeadingIndexByLevel[heading.level] = index;
  }

  sections.reverse();
  return sections;
}

/**
 * Fold service that defines foldable ranges for ATX headings.
 *
 * For a heading at level N, the fold range extends from the end of the
 * heading line to just before the next heading of level <= N (or end of doc).
 */
const headingFoldService = foldService.of((state, lineStart, _lineEnd) => {
  const foldState = state.field(headingFoldField, false);
  const section = foldState?.sectionByHeadingFrom.get(lineStart);
  return section ? { from: section.foldFrom, to: section.foldTo } : null;
});

/** Widget that renders a fold/unfold toggle inline with a heading. */
class FoldToggleWidget extends RenderWidget {
  constructor(
    private readonly pos: number,
    private readonly folded: boolean,
    private readonly level: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    const classes = ["cf-fold-toggle", `cf-fold-h${this.level}`];
    if (this.folded) classes.push("cf-fold-toggle-folded");
    span.className = classes.join(" ");
    span.textContent = this.folded ? "▶" : "▼";
    span.setAttribute("role", "button");
    span.setAttribute("aria-label", this.folded ? "Unfold section" : "Fold section");

    const pos = this.pos;
    span.addEventListener("mousedown", (e) => {
      try {
        e.preventDefault();
        e.stopPropagation();
        // Toggle fold directly without moving the cursor.
        // Query fold services registered on the state to get the fold range.
        const line = view.state.doc.lineAt(pos);
        let range: { from: number; to: number } | null = null;
        for (const service of view.state.facet(foldService)) {
          range = service(view.state, line.from, line.to);
          if (range) break;
        }
        if (range) {
          let alreadyFolded = false;
          foldedRanges(view.state).between(range.from, range.from + 1, () => {
            alreadyFolded = true;
          });
          if (alreadyFolded) {
            view.dispatch({ effects: unfoldEffect.of({ from: range.from, to: range.to }) });
          } else {
            view.dispatch({ effects: foldEffect.of({ from: range.from, to: range.to }) });
          }
        }
      } catch (err: unknown) {
        console.error("[heading-fold] mousedown handler failed", err);
      }
    });

    return span;
  }

  eq(other: FoldToggleWidget): boolean {
    return this.pos === other.pos && this.folded === other.folded && this.level === other.level;
  }
}

/** Build fold toggle decorations for all foldable headings. */
function buildFoldToggles(
  state: EditorState,
  sections: readonly HeadingFoldSection[],
): DecorationSet {
  if (sections.length === 0) return Decoration.none;

  const items: Range<Decoration>[] = [];
  const folded = foldedRanges(state);

  for (const section of sections) {
    let isFolded = false;
    folded.between(section.foldFrom, section.foldFrom + 1, () => {
      isFolded = true;
    });

    const widget = new FoldToggleWidget(
      section.headingFrom,
      isFolded,
      section.level,
    );
    items.push(
      Decoration.line({ class: "cf-fold-line" }).range(section.headingFrom),
    );
    items.push(
      Decoration.widget({ widget, side: -1 }).range(section.headingFrom),
    );
  }

  return buildDecorations(items);
}

function createHeadingFoldState(state: EditorState): HeadingFoldState {
  const sections = buildHeadingFoldSections(state);
  return {
    sections,
    sectionByHeadingFrom: buildSectionByHeadingFrom(sections),
    decorations: buildFoldToggles(state, sections),
  };
}

const headingFoldField = StateField.define<HeadingFoldState>({
  create: createHeadingFoldState,
  update(value, tr) {
    const before = tr.startState.field(documentSemanticsField);
    const after = tr.state.field(documentSemanticsField);
    const headingsChanged = getDocumentAnalysisSliceRevision(before, "headings")
      !== getDocumentAnalysisSliceRevision(after, "headings");

    if (tr.docChanged || headingsChanged) {
      return createHeadingFoldState(tr.state);
    }

    if (tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect))) {
      return {
        ...value,
        decorations: buildFoldToggles(tr.state, value.sections),
      };
    }

    return value;
  },
  compare(a, b) {
    return a.sections === b.sections && a.decorations === b.decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  },
});

/** CM6 extension for heading-based folding with inline toggles. */
export const headingFold: Extension = [
  documentSemanticsField,
  headingFoldService,
  headingFoldField,
  keymap.of(foldKeymap),
];
