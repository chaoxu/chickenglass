import { create } from "zustand";

import type { DiagnosticEntry } from "../app/diagnostics";

export interface DiagnosticsState {
  readonly diagnostics: DiagnosticEntry[];
}

interface DiagnosticsActions {
  readonly setDiagnostics: (diagnostics: DiagnosticEntry[]) => void;
  readonly reset: () => void;
}

type DiagnosticsStore = DiagnosticsState & DiagnosticsActions;

const initialState: DiagnosticsState = {
  diagnostics: [],
};

export const useDiagnosticsStore = create<DiagnosticsStore>()((set) => ({
  ...initialState,

  setDiagnostics: (diagnostics: DiagnosticEntry[]) => {
    set({ diagnostics });
  },

  reset: () => {
    set(initialState);
  },
}));

export function useDiagnostics<T>(selector: (state: DiagnosticsStore) => T): T {
  return useDiagnosticsStore(selector);
}
