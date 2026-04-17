/**
 * diagnostics-store — Zustand store for live markdown diagnostics.
 *
 * Written by EditorPane on every doc change and read by sidebar consumers.
 * Using a store here avoids a setState cascade through the parent on every
 * keystroke, which under fast bulk typing could exceed React's max update
 * depth (React #185).
 */

import { create } from "zustand";
import type { DiagnosticEntry } from "../app/diagnostics";

export interface DiagnosticsState {
  diagnostics: DiagnosticEntry[];
}

interface DiagnosticsActions {
  setDiagnostics: (diagnostics: DiagnosticEntry[]) => void;
  reset: () => void;
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
