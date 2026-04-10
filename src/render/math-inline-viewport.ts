import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  type EditorView,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import {
  mergeRanges,
  mapVisibleRanges,
  snapshotRanges,
  type VisibleRange,
} from "./viewport-diff";

const INLINE_MATH_VIEWPORT_LINE_MARGIN = 8;

function sameRanges(
  left: readonly VisibleRange[],
  right: readonly VisibleRange[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].from !== right[i].from || left[i].to !== right[i].to) {
      return false;
    }
  }
  return true;
}

function fullDocumentRange(state: EditorState): readonly VisibleRange[] {
  return [{ from: 0, to: state.doc.length }];
}

function selectionLineBand(
  state: EditorState,
  lineMargin: number,
): readonly VisibleRange[] {
  if (state.doc.length === 0) {
    return [{ from: 0, to: 0 }];
  }
  return [
    expandRangeToLineBand(
      state,
      {
        from: state.selection.main.from,
        to: state.selection.main.to,
      },
      lineMargin,
    ),
  ];
}

function expandRangeToLineBand(
  state: EditorState,
  range: VisibleRange,
  lineMargin: number,
): VisibleRange {
  if (state.doc.length === 0) {
    return { from: 0, to: 0 };
  }

  const startPos = Math.max(0, Math.min(range.from, state.doc.length));
  const endPos = Math.max(0, Math.min(Math.max(range.from, range.to), state.doc.length));
  const startLineNumber = state.doc.lineAt(startPos).number;
  const endLineNumber = state.doc.lineAt(
    Math.max(startPos, Math.max(0, endPos - 1)),
  ).number;
  const expandedStartLine = Math.max(1, startLineNumber - lineMargin);
  const expandedEndLine = Math.min(state.doc.lines, endLineNumber + lineMargin);
  return {
    from: state.doc.line(expandedStartLine).from,
    to: state.doc.line(expandedEndLine).to,
  };
}

export function computeInlineMathViewportRanges(
  view: EditorView,
  lineMargin = INLINE_MATH_VIEWPORT_LINE_MARGIN,
): readonly VisibleRange[] {
  const visibleRanges = snapshotRanges(view.visibleRanges);
  if (visibleRanges.length === 0) {
    return fullDocumentRange(view.state);
  }

  return mergeRanges(
    visibleRanges.map((range) => expandRangeToLineBand(view.state, range, lineMargin)),
  );
}

export const setInlineMathViewportRangesEffect =
  StateEffect.define<readonly VisibleRange[]>();

export const inlineMathViewportRangesField =
  StateField.define<readonly VisibleRange[]>({
    create(state) {
      return selectionLineBand(state, INLINE_MATH_VIEWPORT_LINE_MARGIN);
    },

    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setInlineMathViewportRangesEffect)) {
          return sameRanges(value, effect.value) ? value : effect.value;
        }
      }

      if (!tr.docChanged) {
        return value;
      }

      const next = mapVisibleRanges(value, tr.changes);
      return sameRanges(value, next) ? value : next;
    },

    compare: sameRanges,
  });

export function getInlineMathViewportRanges(
  state: EditorState,
): readonly VisibleRange[] {
  return state.field(inlineMathViewportRangesField, false) ?? fullDocumentRange(state);
}

function syncInlineMathViewportRanges(view: EditorView): void {
  const next = computeInlineMathViewportRanges(view);
  const current = getInlineMathViewportRanges(view.state);
  if (sameRanges(current, next)) return;
  view.dispatch({
    effects: setInlineMathViewportRangesEffect.of(next),
  });
}

class InlineMathViewportTracker {
  constructor(view: EditorView) {
    queueMicrotask(() => {
      if (view.dom.isConnected) {
        syncInlineMathViewportRanges(view);
      }
    });
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      syncInlineMathViewportRanges(update.view);
    }
  }
}

export const inlineMathViewportTracker: Extension =
  ViewPlugin.fromClass(InlineMathViewportTracker);
