/**
 * useEditorNavigation — focused hook for editor navigation and search-result coordination.
 *
 * Extracted from useAppEditorShell to isolate the navigation cluster:
 * - Outline heading jumps (handleOutlineSelect)
 * - Go-to-line (handleGotoLine)
 * - Cross-file search-result navigation (handleSearchResult)
 * - Editor-readiness synchronization needed by those actions
 *
 * The hook maintains its own view ref so navigation callbacks are always
 * working with the latest CM6 EditorView, even across async boundaries.
 */

import { useRef, useEffect, useCallback } from "react";
import type { EditorView } from "@codemirror/view";

/** Dependencies injected from the shell into the navigation hook. */
export interface EditorNavigationDeps {
  /** Open a file by path (delegates to useEditorSession). */
  openFile: (path: string) => Promise<void>;
  /** Returns true if the given path is the currently open document. */
  isPathOpen: (path: string) => boolean;
  /** The current document path, or null when no file is open. */
  currentPath: string | null;
}

/** Public API surface of the navigation hook. */
export interface EditorNavigationController {
  /**
   * Scroll the editor to `from` (a document character offset) and focus it.
   * Used by the outline panel when the user clicks a heading entry.
   */
  handleOutlineSelect: (from: number) => void;
  /**
   * Move the cursor to a 1-based line and optional 1-based column, then scroll
   * into view. Line numbers are clamped to the document range.
   */
  handleGotoLine: (line: number, col?: number) => void;
  /**
   * Open `file` (if it is not already current) then scroll to character offset `pos`.
   * Uses a stable ref instead of closure-captured state so the view reference
   * is always fresh after the async `openFile` resolves.
   * Calls `onComplete` when navigation finishes.
   */
  handleSearchResult: (file: string, pos: number, onComplete?: () => void) => Promise<boolean>;
  /** Called after the editor has applied the current document/path to the live CM6 view. */
  handleEditorDocumentReady: (view: EditorView, docPath: string | undefined) => void;
  /**
   * Must be called when the editor view changes (mount/unmount/re-mount) so
   * internal refs stay current. When the view goes null, pending readiness
   * waiters are aborted.
   */
  syncView: (view: EditorView | null) => void;
}

export function useEditorNavigation({
  openFile,
  isPathOpen,
  currentPath,
}: EditorNavigationDeps): EditorNavigationController {
  // Stable ref always pointing at the latest view, so async callbacks
  // never capture a stale closure after openFile resolves.
  const latestViewRef = useRef<EditorView | null>(null);
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
    if (latestReadyPathRef.current === path && latestViewRef.current) {
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

  const syncView = useCallback((view: EditorView | null) => {
    latestViewRef.current = view;
    if (!view) {
      latestReadyPathRef.current = null;
      abortReadyWaitersExcept(null);
    }
  }, [abortReadyWaitersExcept]);

  const handleEditorDocumentReady = useCallback((view: EditorView, docPath: string | undefined) => {
    latestViewRef.current = view;
    if (!docPath) {
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
    const view = latestViewRef.current;
    if (!view) return;
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  }, []);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    const view = latestViewRef.current;
    if (!view) return;
    const docLine = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    const offset = docLine.from + (col ? col - 1 : 0);
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
  }, []);

  const handleSearchResult = useCallback(async (
    file: string,
    pos: number,
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

      const view = latestViewRef.current;
      if (view && latestReadyPathRef.current === file) {
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      }
      onComplete?.();
      return true;
    } catch (e: unknown) {
      console.error("[editor] handleSearchResult: failed to open file", file, e);
      return false;
    }
  }, [isPathOpen, openFile, waitForEditorDocumentReady]);

  return {
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleEditorDocumentReady,
    syncView,
  };
}
