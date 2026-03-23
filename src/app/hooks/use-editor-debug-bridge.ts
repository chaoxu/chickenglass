import { useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { createDebugHelpers } from "../../editor";

export interface EditorDebugBridge {
  attachDebugView: (view: EditorView) => void;
  clearDebugView: (view?: EditorView) => void;
}

export function attachDebugView(view: EditorView): void {
  window.__cmView = view;
  window.__cmDebug = createDebugHelpers(view);
}

export function clearDebugView(view?: EditorView): void {
  if (!view || window.__cmView === view) {
    window.__cmView = undefined;
    window.__cmDebug = undefined;
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
