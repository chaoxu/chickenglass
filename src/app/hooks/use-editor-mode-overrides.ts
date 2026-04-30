import { useCallback, useMemo, useRef, useState } from "react";

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
  const [overrides, setOverrides] = useState<Record<string, EditorMode>>({});

  const commitOverride = useCallback((path: string, mode: EditorMode) => {
    setOverrides((prev) => ({ ...prev, [path]: mode }));
  }, []);

  const editorMode = useMemo((): EditorMode => {
    const committed = currentPath ? overrides[currentPath] : undefined;
    if (committed !== undefined) {
      return normalizeEditorMode(committed, isMarkdownFile);
    }
    return normalizeEditorMode(defaultMode ?? defaultEditorMode, isMarkdownFile);
  }, [overrides, currentPath, defaultMode, isMarkdownFile]);

  const handleModeChange = useCallback((mode: EditorMode | string) => {
    runEditorTransaction("mode-switch", () => undefined);
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    if (currentPath) {
      commitOverride(currentPath, normalizedMode);
    }
  }, [
    commitOverride,
    currentPath,
    isMarkdownFile,
    runEditorTransaction,
  ]);

  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const handleSearchResult = useCallback((
    target: SearchNavigationTarget,
    onComplete?: () => void,
  ) => {
    const targetIsMarkdown = target.file.endsWith(".md");
    const normalizedMode = normalizeEditorMode(target.editorMode, targetIsMarkdown);
    const hadPrevious = Object.hasOwn(overridesRef.current, target.file);
    const previousMode = overridesRef.current[target.file];
    commitOverride(target.file, normalizedMode);

    void handleSearchResultNavigation(target.file, target.pos, onComplete).then((opened) => {
      if (opened) return;
      setOverrides((prev) => {
        if (prev[target.file] !== normalizedMode) return prev;
        const next = { ...prev };
        if (hadPrevious) {
          next[target.file] = previousMode;
        } else {
          delete next[target.file];
        }
        return next;
      });
    });
  }, [
    commitOverride,
    handleSearchResultNavigation,
  ]);

  return {
    editorMode,
    handleModeChange,
    handleSearchResult,
  };
}
