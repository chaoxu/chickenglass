/**
 * heading-index-store — Zustand store for live heading index.
 *
 * Driven by the Lexical heading tree via HeadingIndexPlugin rather than
 * regex-based markdown string parsing. Consumers (breadcrumbs, outline,
 * editor-pane) subscribe to this store for heading data.
 */

import { create } from "zustand";
import type { HeadingEntry } from "../app/heading-ancestry";

// ── State shape ─────────────────────────────────────────────────────────────

export interface HeadingIndexState {
  /** Ordered heading entries derived from the live Lexical tree. */
  headings: HeadingEntry[];
}

interface HeadingIndexActions {
  /** Replace the heading list (called by HeadingIndexPlugin). */
  setHeadings: (headings: HeadingEntry[]) => void;
  /** Clear all headings (e.g. when the editor is destroyed). */
  reset: () => void;
}

type HeadingIndexStore = HeadingIndexState & HeadingIndexActions;

// ── Initial state ───────────────────────────────────────────────────────────

const initialState: HeadingIndexState = {
  headings: [],
};

// ── Store ───────────────────────────────────────────────────────────────────

export const useHeadingIndexStore = create<HeadingIndexStore>()((set) => ({
  ...initialState,

  setHeadings: (headings: HeadingEntry[]) => {
    set({ headings });
  },

  reset: () => {
    set(initialState);
  },
}));

/**
 * Convenience hook that selects a slice of the heading index store.
 *
 * Usage:
 * ```ts
 * const headings = useHeadingIndex((s) => s.headings);
 * ```
 */
export function useHeadingIndex<T>(
  selector: (state: HeadingIndexStore) => T,
): T {
  return useHeadingIndexStore(selector);
}
