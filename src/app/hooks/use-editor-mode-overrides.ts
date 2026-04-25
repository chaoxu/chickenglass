import { useCallback, useMemo, useRef, useState } from "react";

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

interface PendingModeOverride {
  path: string;
  mode: EditorMode;
  requestId: number;
}

export interface EditorModeOverridesDeps {
  clearPendingLexicalNavigation: (requestId?: number) => void;
  currentPath: string | null;
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
  const [modeOverrides, setModeOverrides] = useState<Record<string, EditorMode>>({});
  const [pendingModeOverride, setPendingModeOverride] = useState<PendingModeOverride | null>(null);
  const pendingModeRequestIdRef = useRef(0);

  // The pending override is owned by exactly one in-flight requestId at a
  // time; later callbacks must not clobber a newer pending entry. Every
  // pending-clear path goes through this so the invariant lives in one place.
  const clearPendingIfRequest = useCallback((requestId: number) => {
    setPendingModeOverride((previous) =>
      previous?.requestId === requestId ? null : previous,
    );
  }, []);

  const editorMode = useMemo((): EditorMode => {
    const override = currentPath ? modeOverrides[currentPath] : undefined;
    if (override !== undefined) {
      return normalizeEditorMode(override, isMarkdownFile);
    }
    if (pendingModeOverride && pendingModeOverride.path === currentPath) {
      return normalizeEditorMode(pendingModeOverride.mode, isMarkdownFile);
    }
    return normalizeEditorMode(defaultEditorMode, isMarkdownFile);
  }, [modeOverrides, pendingModeOverride, currentPath, isMarkdownFile]);

  const handleModeChange = useCallback((mode: EditorMode | string) => {
    const { flush: flushResult } = runEditorTransaction("mode-switch", () => undefined);
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    const applyModeOverride = () => {
      const finishModeOverride = () => {
        if (currentPath) {
          setModeOverrides((previous) => ({
            ...previous,
            [currentPath]: normalizedMode,
          }));
        }
        setPendingModeOverride((previous) =>
          previous?.path === currentPath ? null : previous,
        );
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
    setPendingModeOverride({
      path: target.file,
      mode: normalizedMode,
      requestId,
    });
    if (isLexicalEditorMode(normalizedMode)) {
      const completeLexicalNavigation = () => {
        clearPendingIfRequest(requestId);
        setModeOverrides((previous) => ({
          ...previous,
          [target.file]: normalizedMode,
        }));
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
      clearPendingIfRequest(requestId);
      if (!opened) {
        return;
      }
      setModeOverrides((previous) => ({
        ...previous,
        [target.file]: normalizedMode,
      }));
    });
  }, [
    clearPendingLexicalNavigation,
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
