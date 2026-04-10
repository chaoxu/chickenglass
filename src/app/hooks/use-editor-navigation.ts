import { useRef, useEffect, useCallback } from "react";

import type { MarkdownEditorHandle } from "../../lexical/plain-text-editor";
import { getOffsetForLineAndColumn } from "../markdown/text-lines";

export interface EditorNavigationDeps {
  readonly openFile: (path: string) => Promise<void>;
  readonly isPathOpen: (path: string) => boolean;
  readonly currentPath: string | null;
  readonly getCurrentDocText: () => string;
}

export interface EditorNavigationController {
  readonly handleOutlineSelect: (from: number) => void;
  readonly handleGotoLine: (line: number, col?: number) => void;
  readonly handleSearchResult: (
    file: string,
    pos: number,
    options?: { focusSelection?: boolean },
    onComplete?: () => void,
  ) => Promise<boolean>;
  readonly handleEditorDocumentReady: (docPath: string | undefined) => void;
  readonly syncHandle: (handle: MarkdownEditorHandle | null) => void;
}

export function useEditorNavigation({
  openFile,
  isPathOpen,
  currentPath,
  getCurrentDocText,
}: EditorNavigationDeps): EditorNavigationController {
  const latestHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const latestReadyPathRef = useRef<string | null>(null);
  const readyPathWaitersRef = useRef<Map<string, Set<(ready: boolean) => void>>>(new Map());
  const searchRequestRef = useRef(0);

  const resolveReadyWaiters = useCallback((path: string, ready: boolean) => {
    const waiters = readyPathWaitersRef.current.get(path);
    if (!waiters) {
      return;
    }
    readyPathWaitersRef.current.delete(path);
    waiters.forEach((resolve) => resolve(ready));
  }, []);

  const abortReadyWaitersExcept = useCallback((activePath: string | null) => {
    for (const [path, waiters] of readyPathWaitersRef.current) {
      if (path === activePath) {
        continue;
      }
      readyPathWaitersRef.current.delete(path);
      waiters.forEach((resolve) => resolve(false));
    }
  }, []);

  const waitForEditorDocumentReady = useCallback((path: string): Promise<boolean> => {
    if (latestReadyPathRef.current === path && latestHandleRef.current) {
      return Promise.resolve(true);
    }
    if (!isPathOpen(path)) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const waiters = readyPathWaitersRef.current.get(path) ?? new Set<(ready: boolean) => void>();
      waiters.add(resolve);
      readyPathWaitersRef.current.set(path, waiters);
    });
  }, [isPathOpen]);

  const syncHandle = useCallback((handle: MarkdownEditorHandle | null) => {
    latestHandleRef.current = handle;
    if (!handle) {
      latestReadyPathRef.current = null;
      abortReadyWaitersExcept(null);
    }
  }, [abortReadyWaitersExcept]);

  const handleEditorDocumentReady = useCallback((docPath: string | undefined) => {
    if (!docPath || !latestHandleRef.current) {
      return;
    }
    latestReadyPathRef.current = docPath;
    abortReadyWaitersExcept(docPath);
    resolveReadyWaiters(docPath, true);
  }, [abortReadyWaitersExcept, resolveReadyWaiters]);

  useEffect(() => {
    abortReadyWaitersExcept(currentPath);
  }, [abortReadyWaitersExcept, currentPath]);

  const handleOutlineSelect = useCallback((from: number) => {
    const handle = latestHandleRef.current;
    if (!handle) {
      return;
    }
    handle.setSelection(from);
    handle.focus();
  }, []);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    const handle = latestHandleRef.current;
    if (!handle) {
      return;
    }
    const offset = getOffsetForLineAndColumn(getCurrentDocText(), line, col);
    handle.setSelection(offset);
    handle.focus();
  }, [getCurrentDocText]);

  const handleSearchResult = useCallback(async (
    file: string,
    pos: number,
    options?: { focusSelection?: boolean },
    onComplete?: () => void,
  ): Promise<boolean> => {
    const requestId = ++searchRequestRef.current;

    try {
      await openFile(file);
      if (requestId !== searchRequestRef.current || !isPathOpen(file)) {
        onComplete?.();
        return false;
      }

      const didBecomeReady = await waitForEditorDocumentReady(file);
      if (!didBecomeReady) {
        onComplete?.();
        return isPathOpen(file);
      }

      if (requestId !== searchRequestRef.current || !isPathOpen(file)) {
        onComplete?.();
        return false;
      }

      const handle = latestHandleRef.current;
      if (options?.focusSelection !== false && handle && latestReadyPathRef.current === file) {
        handle.setSelection(pos);
        handle.focus();
      }
      onComplete?.();
      return true;
    } catch (error: unknown) {
      console.error("[editor] handleSearchResult: failed to open file", file, error);
      return false;
    }
  }, [isPathOpen, openFile, waitForEditorDocumentReady]);

  return {
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleEditorDocumentReady,
    syncHandle,
  };
}
