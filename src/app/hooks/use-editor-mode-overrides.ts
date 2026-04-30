import { useCallback, useMemo, useReducer, useRef } from "react";

import {
  defaultEditorMode,
  normalizeEditorMode,
  type EditorMode,
} from "../../editor-display-mode";
import type { SearchNavigationTarget } from "../search";
import type {
  EditorTransactionIntent,
  EditorTransactionResult,
} from "./use-editor-transactions";
import {
  getCommittedModeOverride,
  getPendingModeOverride,
  initialEditorModeOverrideState,
  transitionEditorModeOverride,
} from "./editor-mode-override-state";

export interface EditorModeOverridesDeps {
  currentPath: string | null;
  defaultMode: EditorMode;
  handleSearchResultNavigation: (
    file: string,
    pos: number,
    onComplete?: () => void,
  ) => Promise<boolean>;
  isMarkdownFile: boolean;
  runEditorTransaction: <T>(
    intent: EditorTransactionIntent,
    body: () => T,
  ) => EditorTransactionResult<T>;
}

export interface EditorModeOverridesController {
  editorMode: EditorMode;
  handleModeChange: (mode: EditorMode | string) => void;
  handleSearchResult: (target: SearchNavigationTarget, onComplete?: () => void) => void;
}

export function useEditorModeOverrides({
  currentPath,
  defaultMode,
  handleSearchResultNavigation,
  isMarkdownFile,
  runEditorTransaction,
}: EditorModeOverridesDeps): EditorModeOverridesController {
  const [overrideState, dispatchOverrideTransition] = useReducer(
    transitionEditorModeOverride,
    initialEditorModeOverrideState,
  );
  const pendingModeRequestIdRef = useRef(0);

  const clearPendingIfRequest = useCallback((requestId: number) => {
    dispatchOverrideTransition({ type: "clear-pending", requestId });
  }, []);

  const editorMode = useMemo((): EditorMode => {
    const pendingOverride = getPendingModeOverride(overrideState, currentPath);
    if (pendingOverride !== undefined) {
      return normalizeEditorMode(pendingOverride, isMarkdownFile);
    }
    const committedOverride = getCommittedModeOverride(overrideState, currentPath);
    if (committedOverride !== undefined) {
      return normalizeEditorMode(committedOverride, isMarkdownFile);
    }
    return normalizeEditorMode(defaultMode ?? defaultEditorMode, isMarkdownFile);
  }, [overrideState, currentPath, defaultMode, isMarkdownFile]);

  const handleModeChange = useCallback((mode: EditorMode | string) => {
    const { flush: flushResult } = runEditorTransaction("mode-switch", () => undefined);
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    const applyModeOverride = () => {
      if (currentPath) {
        dispatchOverrideTransition({
          type: "commit",
          target: { path: currentPath, mode: normalizedMode },
        });
      }
    };
    if (flushResult.shouldDeferModeSwitch) {
      window.setTimeout(applyModeOverride, 0);
    } else {
      applyModeOverride();
    }
  }, [
    currentPath,
    isMarkdownFile,
    runEditorTransaction,
  ]);

  const handleSearchResult = useCallback((
    target: SearchNavigationTarget,
    onComplete?: () => void,
  ) => {
    const targetIsMarkdown = target.file.endsWith(".md");
    const normalizedMode = normalizeEditorMode(target.editorMode, targetIsMarkdown);
    const requestId = ++pendingModeRequestIdRef.current;
    dispatchOverrideTransition({
      type: "begin",
      requestId,
      target: { path: target.file, mode: normalizedMode },
    });

    void handleSearchResultNavigation(target.file, target.pos, onComplete).then((opened) => {
      if (!opened) {
        clearPendingIfRequest(requestId);
        return;
      }
      dispatchOverrideTransition({
        type: "commit",
        requestId,
        target: { path: target.file, mode: normalizedMode },
      });
    });
  }, [
    clearPendingIfRequest,
    handleSearchResultNavigation,
  ]);

  return {
    editorMode,
    handleModeChange,
    handleSearchResult,
  };
}
