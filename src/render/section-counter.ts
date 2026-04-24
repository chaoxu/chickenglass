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
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { buildDecorations } from "./decoration-core";
import { documentSemanticsField } from "../state/document-analysis";
import { createChangeChecker } from "../state/change-detection";
import type { HeadingSemantics } from "../semantics/document";

const STICKY_SECTION_NUMBER_MS = 500;

interface StickySectionNumber {
  readonly expiresAt: number;
  readonly from: number;
  readonly number: string;
  readonly to: number;
}

interface SectionNumberState {
  readonly decorations: DecorationSet;
  readonly sticky: readonly StickySectionNumber[];
}

export const clearStickySectionNumbersEffect = StateEffect.define<void>();

/** Build section-number decorations for all headings in the document. */
export function buildSectionDecorations(state: EditorState): DecorationSet {
  return buildSectionDecorationsForHeadings(
    state,
    state.field(documentSemanticsField).headings,
  );
}

function buildSectionDecorationsForHeadings(
  state: EditorState,
  headings: readonly Pick<HeadingSemantics, "from" | "number">[],
): DecorationSet {
  const items: Range<Decoration>[] = [];
  const occupiedLines = new Set<number>();

  const addNumber = (from: number, number: string): void => {
    if (!number) return;
    const line = state.doc.lineAt(Math.max(0, Math.min(from, state.doc.length)));
    if (occupiedLines.has(line.from)) return;
    occupiedLines.add(line.from);
    items.push(
      Decoration.line({
        attributes: { "data-section-number": number },
      }).range(line.from),
    );
  };

  for (const heading of headings) {
    addNumber(heading.from, heading.number);
  }

  return buildDecorations(items);
}

function sameSectionHeadingTopology(
  before: readonly { readonly from: number; readonly level: number; readonly unnumbered: boolean }[],
  after: readonly { readonly from: number; readonly level: number; readonly unnumbered: boolean }[],
): boolean {
  if (before.length !== after.length) {
    return false;
  }

  for (let index = 0; index < before.length; index += 1) {
    if (
      before[index].from !== after[index].from ||
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

function mapHeading(
  heading: HeadingSemantics,
  tr: Transaction,
  expiresAt: number,
): StickySectionNumber {
  const from = tr.changes.mapPos(heading.from, 1);
  return {
    expiresAt,
    from,
    number: heading.number,
    to: Math.max(from, tr.changes.mapPos(heading.to, -1)),
  };
}

function rangesTouch(
  left: { readonly from: number; readonly to: number },
  right: { readonly from: number; readonly to: number },
): boolean {
  return left.from <= right.to && right.from <= left.to;
}

function selectionTouchesHeading(
  state: EditorState,
  heading: Pick<StickySectionNumber, "from" | "to">,
): boolean {
  const selection = state.selection.main;
  return rangesTouch(
    {
      from: Math.max(0, Math.min(selection.from, state.doc.length)),
      to: Math.max(0, Math.min(selection.to, state.doc.length)),
    },
    {
      from: Math.max(0, Math.min(heading.from, state.doc.length)),
      to: Math.max(0, Math.min(heading.to, state.doc.length)),
    },
  );
}

function hasCurrentHeadingAtLine(
  state: EditorState,
  headings: readonly HeadingSemantics[],
  heading: Pick<StickySectionNumber, "from">,
): boolean {
  const line = state.doc.lineAt(Math.max(0, Math.min(heading.from, state.doc.length)));
  return headings.some((current) => current.from === line.from);
}

function collectStickySectionNumbers(tr: Transaction): readonly StickySectionNumber[] {
  const before = tr.startState.field(documentSemanticsField).headings;
  const after = tr.state.field(documentSemanticsField).headings;
  if (before.length <= after.length) return [];

  const expiresAt = Date.now() + STICKY_SECTION_NUMBER_MS;
  const mappedBefore = before
    .filter((heading) => heading.number && !heading.unnumbered)
    .map((heading) => mapHeading(heading, tr, expiresAt));
  const hasActiveDroppedHeading = mappedBefore.some((heading) =>
    selectionTouchesHeading(tr.state, heading) &&
    !hasCurrentHeadingAtLine(tr.state, after, heading)
  );

  return hasActiveDroppedHeading ? mappedBefore : [];
}

function preserveActiveStickySectionNumbers(
  state: EditorState,
  sticky: readonly StickySectionNumber[],
): readonly StickySectionNumber[] {
  const now = Date.now();
  const current = state.field(documentSemanticsField).headings;
  if (!sticky.some((heading) =>
    heading.expiresAt > now &&
    selectionTouchesHeading(state, heading) &&
    !hasCurrentHeadingAtLine(state, current, heading)
  )) {
    return [];
  }
  return sticky.filter((heading) => heading.expiresAt > now);
}

function buildSectionNumberState(
  state: EditorState,
  sticky: readonly StickySectionNumber[] = [],
): SectionNumberState {
  const headings = state.field(documentSemanticsField).headings;
  return {
    decorations: sticky.length > 0
      ? buildSectionDecorationsForHeadings(state, sticky)
      : buildSectionDecorationsForHeadings(state, headings),
    sticky,
  };
}

export const sectionNumberField = StateField.define<SectionNumberState>({
  create(state) {
    return buildSectionNumberState(state);
  },
  update(value, tr) {
    if (tr.effects.some((effect) => effect.is(clearStickySectionNumbersEffect))) {
      return buildSectionNumberState(tr.state);
    }

    const nextSticky = [
      ...preserveActiveStickySectionNumbers(tr.state, value.sticky),
      ...collectStickySectionNumbers(tr),
    ];
    if (nextSticky.length > 0) {
      return buildSectionNumberState(tr.state, nextSticky);
    }

    if (sectionShouldRebuild(tr)) {
      return buildSectionNumberState(tr.state);
    }
    if (tr.docChanged) {
      return {
        decorations: value.decorations.map(tr.changes),
        sticky: [],
      };
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  },
});

const stickySectionNumberExpiryPlugin = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((tr) => tr.effects.length > 0)
    ) {
      this.schedule();
    }
  }

  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const sticky = this.view.state.field(sectionNumberField).sticky;
    const expiresAt = sticky.reduce(
      (earliest, heading) => Math.min(earliest, heading.expiresAt),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(expiresAt)) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.view.dispatch({ effects: clearStickySectionNumbersEffect.of(undefined) });
    }, Math.max(0, expiresAt - Date.now()));
  }
});

/** CM6 extension that adds hierarchical section numbers to headings. */
export const sectionNumberPlugin: Extension = [
  documentSemanticsField,
  sectionNumberField,
  stickySectionNumberExpiryPlugin,
];
