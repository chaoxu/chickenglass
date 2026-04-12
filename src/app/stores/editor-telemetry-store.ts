/**
 * editor-telemetry-store — Zustand store for high-frequency editor telemetry.
 *
 * Cursor position, scroll offset, and word count update on every keystroke or
 * scroll event. Storing them in React state at the app root causes the entire
 * shell (sidebar, tab bar, overlays) to rerender on each change.
 *
 * This store keeps that data outside React's tree. Only the StatusBar (and any
 * future consumer that needs these values) subscribes via a fine-grained
 * selector, so rerenders are scoped to the leaf component.
 */

import { create } from "zustand";
import { getTextPosition } from "../markdown/text-lines";

// ── State shape ─────────────────────────────────────────────────────────────

export interface EditorTelemetryState {
  /** Character offset of the cursor head in the active document. */
  cursorPos: number;
  /** 1-based line number of the cursor. */
  cursorLine: number;
  /** 1-based column of the cursor within its line. */
  cursorCol: number;
  /** Current scroll top of the editor scroller (px). */
  scrollTop: number;
  /** Character offset of the first visible line in the viewport. */
  viewportFrom: number;
  /** Word count of the active document (debounced). */
  wordCount: number;
  /** Character count of the document body (debounced, excludes frontmatter). */
  charCount: number;
}

/**
 * Partial telemetry update. Any subset of fields may be provided.
 *
 * `cursorPos` requires a `doc` to resolve line/column. Callers pass the live
 * doc alongside; the store derives `cursorLine` / `cursorCol` atomically so
 * subscribers never observe a stale line/col against a fresh `cursorPos`.
 */
export interface EditorTelemetryUpdate {
  readonly cursorPos?: number;
  readonly doc?: string;
  readonly scrollTop?: number;
  readonly viewportFrom?: number;
}

interface EditorTelemetryActions {
  /** Apply a partial telemetry update in a single store write. */
  setTelemetry: (update: EditorTelemetryUpdate) => void;
  /** Update word and character counts together. */
  setLiveCounts: (words: number, chars: number) => void;
  /** Reset all telemetry (e.g. when the editor is destroyed / tab switches). */
  reset: () => void;
}

type EditorTelemetryStore = EditorTelemetryState & EditorTelemetryActions;

// ── Initial state ───────────────────────────────────────────────────────────

const initialState: EditorTelemetryState = {
  cursorPos: 0,
  cursorLine: 1,
  cursorCol: 1,
  scrollTop: 0,
  viewportFrom: 0,
  wordCount: 0,
  charCount: 0,
};

function resolveCursorLineCol(
  pos: number,
  doc: string,
): { line: number; col: number } {
  try {
    const resolved = getTextPosition(doc, pos);
    return { line: resolved.line, col: resolved.col };
  } catch {
    // Stale offset after doc change — use defaults.
    return { line: 1, col: 1 };
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useEditorTelemetryStore = create<EditorTelemetryStore>()(
  (set) => ({
    ...initialState,

    setTelemetry: ({ cursorPos, doc, scrollTop, viewportFrom }) => {
      const next: Partial<EditorTelemetryState> = {};
      if (cursorPos !== undefined) {
        next.cursorPos = cursorPos;
        if (doc !== undefined) {
          const { line, col } = resolveCursorLineCol(cursorPos, doc);
          next.cursorLine = line;
          next.cursorCol = col;
        }
      }
      if (scrollTop !== undefined) {
        next.scrollTop = scrollTop;
      }
      if (viewportFrom !== undefined) {
        next.viewportFrom = viewportFrom;
      }
      if (Object.keys(next).length > 0) {
        set(next);
      }
    },

    setLiveCounts: (words: number, chars: number) => {
      set({ wordCount: words, charCount: chars });
    },

    reset: () => {
      set(initialState);
    },
  }),
);

/**
 * Convenience hook that selects a slice of the telemetry store.
 *
 * Usage:
 * ```ts
 * const wordCount = useEditorTelemetry((s) => s.wordCount);
 * const { cursorLine, cursorCol } = useEditorTelemetry((s) => ({
 *   cursorLine: s.cursorLine,
 *   cursorCol: s.cursorCol,
 * }));
 * ```
 */
export function useEditorTelemetry<T>(
  selector: (state: EditorTelemetryStore) => T,
): T {
  return useEditorTelemetryStore(selector);
}
