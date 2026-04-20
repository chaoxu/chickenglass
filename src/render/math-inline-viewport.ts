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
  mapVisibleRanges,
  mergeRanges,
  type VisibleRange,
} from "./viewport-diff";

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

function clampVisibleRanges(
  ranges: readonly VisibleRange[],
  docLength: number,
): readonly VisibleRange[] {
  return mergeRanges(
    ranges.map((range) => {
      const from = Math.max(0, Math.min(range.from, docLength));
      const to = Math.max(from, Math.min(range.to, docLength));
      return { from, to };
    }),
  );
}

export function computeInlineMathViewportRanges(
  view: EditorView,
): readonly VisibleRange[] {
  // Inline replacement math changes line wrapping, so viewport-only mounting
  // feeds back into CM6's height map and can cause large reverse scroll jumps
  // on dense documents. Keep the rendered inline-math surface document-wide
  // until we have a layout-stable local strategy.
  return fullDocumentRange(view.state);
}

export const setInlineMathViewportRangesEffect =
  StateEffect.define<readonly VisibleRange[]>();

export const inlineMathViewportRangesField =
  StateField.define<readonly VisibleRange[]>({
    create(state) {
      return fullDocumentRange(state);
    },

    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setInlineMathViewportRangesEffect)) {
          const next = clampVisibleRanges(effect.value, tr.state.doc.length);
          return sameRanges(value, next) ? value : next;
        }
      }

      if (!tr.docChanged) {
        return value;
      }

      const next = clampVisibleRanges(
        mapVisibleRanges(value, tr.changes),
        tr.state.doc.length,
      );
      return sameRanges(value, next) ? value : next;
    },

    compare: sameRanges,
  });

export function getInlineMathViewportRanges(
  state: EditorState,
): readonly VisibleRange[] {
  return clampVisibleRanges(
    state.field(inlineMathViewportRangesField, false) ?? fullDocumentRange(state),
    state.doc.length,
  );
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
  private syncScheduled = false;

  constructor(view: EditorView) {
    this.scheduleSync(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.scheduleSync(update.view);
    }
  }

  private scheduleSync(view: EditorView): void {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    queueMicrotask(() => {
      this.syncScheduled = false;
      if (view.dom.isConnected) {
        syncInlineMathViewportRanges(view);
      }
    });
  }

  destroy(): void {
    this.syncScheduled = false;
  }
}

export const inlineMathViewportTracker: Extension =
  ViewPlugin.fromClass(InlineMathViewportTracker);
