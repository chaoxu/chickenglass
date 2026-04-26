import { useCallback, useMemo, useReducer, useRef } from "react";

import {
  defaultEditorMode,
  isLexicalEditorMode,
  normalizeEditorMode,
  type EditorMode,
} from "../../editor-display-mode";
import type { SearchNavigationTarget } from "../search";
import type {
  EditorTransactionIntent,
  EditorTransactionResult,
} from "./use-editor-transactions";
import type { PendingLexicalNavigation } from "./use-editor-surface-handles";
import {
  getCommittedModeOverride,
  getPendingModeOverride,
  initialEditorModeOverrideState,
  transitionEditorModeOverride,
} from "./editor-mode-override-state";

export interface EditorModeOverridesDeps {
  clearPendingLexicalNavigation: (requestId?: number) => void;
  currentPath: string | null;
  defaultMode: EditorMode;
  editorDoc: string;
  getSessionCurrentDocText: () => string;
  handleSearchResultNavigation: (
    file: string,
    pos: number,
    onComplete?: () => void,
  ) => Promise<boolean>;
  isMarkdownFile: boolean;
  isPathOpen: (path: string) => boolean;
  openFile: (path: string) => Promise<void>;
  queueLexicalNavigation: (navigation: PendingLexicalNavigation) => void;
  runEditorTransaction: <T>(
    intent: EditorTransactionIntent,
    body: () => T,
  ) => EditorTransactionResult<T>;
  sessionHandleDocumentSnapshot: (doc: string) => void;
}

export interface EditorModeOverridesController {
  editorMode: EditorMode;
  handleModeChange: (mode: EditorMode | string) => void;
  handleSearchResult: (target: SearchNavigationTarget, onComplete?: () => void) => void;
}

export function useEditorModeOverrides({
  clearPendingLexicalNavigation,
  currentPath,
  defaultMode,
  editorDoc,
  getSessionCurrentDocText,
  handleSearchResultNavigation,
  isMarkdownFile,
  isPathOpen,
  openFile,
  queueLexicalNavigation,
  runEditorTransaction,
  sessionHandleDocumentSnapshot,
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
      const finishModeOverride = () => {
        if (currentPath) {
          dispatchOverrideTransition({
            type: "commit",
            target: { path: currentPath, mode: normalizedMode },
          });
        }
      };
      if (
        isLexicalEditorMode(normalizedMode) &&
        !isLexicalEditorMode(editorMode)
      ) {
        const liveDoc = getSessionCurrentDocText();
        if (liveDoc !== editorDoc) {
          sessionHandleDocumentSnapshot(liveDoc);
          window.setTimeout(finishModeOverride, 0);
          return;
        }
      }
      finishModeOverride();
    };
    if (flushResult.shouldDeferModeSwitch) {
      window.setTimeout(applyModeOverride, 0);
    } else {
      applyModeOverride();
    }
  }, [
    currentPath,
    editorDoc,
    editorMode,
    getSessionCurrentDocText,
    isMarkdownFile,
    runEditorTransaction,
    sessionHandleDocumentSnapshot,
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
    if (isLexicalEditorMode(normalizedMode)) {
      const completeLexicalNavigation = () => {
        dispatchOverrideTransition({
          type: "commit",
          requestId,
          target: { path: target.file, mode: normalizedMode },
        });
        onComplete?.();
      };
      queueLexicalNavigation({
        onComplete: completeLexicalNavigation,
        path: target.file,
        pos: target.pos,
        requestId,
      });
      void openFile(target.file).then(() => {
        if (!isPathOpen(target.file)) {
          clearPendingLexicalNavigation(requestId);
          clearPendingIfRequest(requestId);
          onComplete?.();
        }
      }).catch((error: unknown) => {
        clearPendingLexicalNavigation(requestId);
        clearPendingIfRequest(requestId);
        console.error("[editor] handleSearchResult: failed to open file", target.file, error);
        onComplete?.();
      });
      return;
    }

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
    clearPendingLexicalNavigation,
    clearPendingIfRequest,
    handleSearchResultNavigation,
    isPathOpen,
    openFile,
    queueLexicalNavigation,
  ]);

  return {
    editorMode,
    handleModeChange,
    handleSearchResult,
  };
}
