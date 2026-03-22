import { useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { createDebugHelpers, type DebugHelpers } from "../../editor/debug-helpers";

interface DebugWindow {
  __cmView?: EditorView;
  __cmDebug?: DebugHelpers;
}

export interface EditorDebugBridge {
  attachDebugView: (view: EditorView) => void;
  clearDebugView: (view?: EditorView) => void;
}

export function attachDebugView(view: EditorView): void {
  const debugWindow = window as unknown as DebugWindow;
  debugWindow.__cmView = view;
  debugWindow.__cmDebug = createDebugHelpers(view);
}

export function clearDebugView(view?: EditorView): void {
  const debugWindow = window as unknown as DebugWindow;
  if (!view || debugWindow.__cmView === view) {
    debugWindow.__cmView = undefined;
    debugWindow.__cmDebug = undefined;
  }
}

export function useEditorDebugBridge(): EditorDebugBridge {
  const attach = useCallback((view: EditorView) => {
    attachDebugView(view);
  }, []);

  const clear = useCallback((view?: EditorView) => {
    clearDebugView(view);
  }, []);

  return { attachDebugView: attach, clearDebugView: clear };
}
