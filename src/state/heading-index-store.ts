import { create } from "zustand";

import type { HeadingEntry } from "../app/heading-ancestry";

export interface HeadingIndexState {
  readonly headings: HeadingEntry[];
}

interface HeadingIndexActions {
  readonly setHeadings: (headings: HeadingEntry[]) => void;
  readonly reset: () => void;
}

type HeadingIndexStore = HeadingIndexState & HeadingIndexActions;

const initialState: HeadingIndexState = {
  headings: [],
};

export const useHeadingIndexStore = create<HeadingIndexStore>()((set) => ({
  ...initialState,

  setHeadings: (headings: HeadingEntry[]) => {
    set({ headings });
  },

  reset: () => {
    set(initialState);
  },
}));

export function useHeadingIndex<T>(selector: (state: HeadingIndexStore) => T): T {
  return useHeadingIndexStore(selector);
}
