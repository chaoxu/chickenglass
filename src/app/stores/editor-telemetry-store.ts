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
import type { EditorView } from "@codemirror/view";

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

interface EditorTelemetryActions {
  /** Update cursor position and derive line/col from the view. */
  setCursorPos: (pos: number, view: EditorView) => void;
  /** Update scroll metrics. */
  setScroll: (top: number, from: number) => void;
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

// ── Store ───────────────────────────────────────────────────────────────────

export const useEditorTelemetryStore = create<EditorTelemetryStore>()(
  (set) => ({
    ...initialState,

    setCursorPos: (pos: number, view: EditorView) => {
      try {
        const line = view.state.doc.lineAt(pos);
        set({
          cursorPos: pos,
          cursorLine: line.number,
          cursorCol: pos - line.from + 1,
        });
      } catch {
        // Stale offset after doc change — use defaults.
        set({ cursorPos: pos, cursorLine: 1, cursorCol: 1 });
      }
    },

    setScroll: (top: number, from: number) => {
      set({ scrollTop: top, viewportFrom: from });
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
