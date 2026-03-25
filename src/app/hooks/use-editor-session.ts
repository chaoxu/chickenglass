/**
 * useEditorSession — unified tab/buffer lifecycle and file operations.
 *
 * Owns in-memory document session state (tabs, buffers, dirty tracking) and
 * delegates filesystem mutation callbacks to useFileOperations. Editor shell
 * consumers get a single stable object from this hook.
 *
 * State management notes:
 * - stateRef is an eagerly-updated mirror of sessionState used by callbacks
 *   to avoid stale closure reads. It is NOT exported; callers use the derived
 *   React state (openTabs, activeTab) or stable callbacks instead.
 * - getSessionState() returns the latest state synchronously from stateRef.
 *   useFileOperations receives this getter so it never needs a raw RefObject.
 *
 * Internal structure:
 * - useSessionStateCore — refs, state, commit helper
 * - useTabCallbacks — tab switching, reorder, rename buffers, pin
 * - useOpenFileCallbacks — openFile, openFileWithContent
 */

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FileSystem } from "../file-manager";
import type { Tab } from "../tab-bar";
import { basename } from "../lib/utils";
import { withPerfOperation } from "../perf";
import {
  activateSessionTab,
  markSessionTabDirty,
  openSessionTab,
  pinSessionTab,
  renameSessionTab,
  reorderSessionTabs,
} from "../editor-session-actions";
import {
  createEditorSessionState,
  findPreviewTab,
  findSessionTab,
  hasSessionPath,
  type EditorSessionState,
} from "../editor-session-model";
import { useFileOperations } from "./use-file-operations";

export interface EditorSessionDeps {
  fs: FileSystem;
  refreshTree: () => Promise<void>;
  addRecentFile: (path: string) => void;
}

export interface UseEditorSessionReturn {
  openTabs: Tab[];
  activeTab: string | null;
  editorDoc: string;
  setEditorDoc: React.Dispatch<React.SetStateAction<string>>;
  buffers: React.RefObject<Map<string, string>>;
  liveDocs: React.RefObject<Map<string, string>>;
  /** Returns true if the given path is currently open in a tab. */
  isPathOpen: (path: string) => boolean;
  handleDocChange: (doc: string) => void;
  switchToTab: (path: string) => void;
  reorderTabs: (tabs: Tab[]) => void;
  renameBuffers: (oldPath: string, newPath: string) => void;
  openFile: (path: string, options?: { preview?: boolean }) => Promise<void>;
  openFileWithContent: (name: string, content: string) => void;
  saveFile: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeFile: (path: string) => Promise<void>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
  pinTab: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

async function executeOpenFile(
  path: string,
  options: { preview?: boolean } | undefined,
  fs: FileSystem,
  stateRef: RefObject<EditorSessionState>,
  buffers: RefObject<Map<string, string>>,
  liveDocs: RefObject<Map<string, string>>,
  openFileRequestRef: RefObject<number>,
  addRecentFile: (path: string) => void,
  commitSessionState: (s: EditorSessionState, opts?: { syncEditorDoc?: boolean }) => void,
): Promise<void> {
  const isPreview = options?.preview ?? false;
  const requestId = ++openFileRequestRef.current;

  await withPerfOperation("open_file", async (operation) => {
    if (hasSessionPath(stateRef.current, path)) {
      operation.measureSync("open_file.activate", () => {
        if (requestId !== openFileRequestRef.current) return;
        const existing = findSessionTab(stateRef.current, path);
        if (!existing) return;
        commitSessionState(openSessionTab(stateRef.current, {
          path, name: existing.name, dirty: existing.dirty, preview: isPreview,
        }));
        addRecentFile(path);
      }, { category: "open_file", detail: path });
      return;
    }

    try {
      const content = await operation.measureAsync(
        "open_file.read", () => fs.readFile(path), { category: "open_file", detail: path },
      );
      operation.measureSync("open_file.tab_state", () => {
        if (requestId !== openFileRequestRef.current) return;
        const currentState = stateRef.current;
        const replacedPreview = isPreview ? findPreviewTab(currentState) : undefined;
        buffers.current.set(path, content);
        liveDocs.current.set(path, content);
        if (replacedPreview && replacedPreview.path !== path) {
          buffers.current.delete(replacedPreview.path);
          liveDocs.current.delete(replacedPreview.path);
        }
        commitSessionState(openSessionTab(currentState, {
          path, name: basename(path), dirty: false, preview: isPreview,
        }));
        addRecentFile(path);
      }, { category: "open_file", detail: path });
    } catch (e: unknown) {
      console.error("[session] failed to open file:", path, e);
    }
  }, path);
}

// ---------------------------------------------------------------------------
// Internal sub-hooks (module-private)
// ---------------------------------------------------------------------------

/** Holds the reactive session state, refs, and the commit helper. */
function useSessionStateCore() {
  const [sessionState, setSessionState] = useState<EditorSessionState>(
    () => createEditorSessionState(),
  );
  const [editorDoc, setEditorDoc] = useState("");
  const buffers = useRef<Map<string, string>>(new Map());
  const liveDocs = useRef<Map<string, string>>(new Map());
  const stateRef = useRef<EditorSessionState>(sessionState);
  const openFileRequestRef = useRef(0);

  const docForPath = useCallback((path: string | null): string => {
    if (!path) return "";
    return liveDocs.current.get(path) ?? buffers.current.get(path) ?? "";
  }, []);

  const commitSessionState = useCallback((
    nextState: EditorSessionState,
    options?: { syncEditorDoc?: boolean },
  ) => {
    const shouldSyncEditorDoc = options?.syncEditorDoc
      ?? nextState.activePath !== stateRef.current.activePath;
    // Update the ref eagerly so subsequent synchronous reads within the same
    // event tick see the new state before React re-renders.
    stateRef.current = nextState;
    setSessionState(nextState);
    if (shouldSyncEditorDoc) {
      setEditorDoc(docForPath(nextState.activePath));
    }
  }, [docForPath]);

  const getSessionState = useCallback((): EditorSessionState => stateRef.current, []);

  return {
    sessionState, editorDoc, setEditorDoc,
    buffers, liveDocs, stateRef, openFileRequestRef,
    commitSessionState, getSessionState,
  };
}

/** Tab-level mutation callbacks: switch, reorder, rename buffers, pin, dirty tracking. */
function useTabCallbacks(
  stateRef: RefObject<EditorSessionState>,
  buffers: RefObject<Map<string, string>>,
  liveDocs: RefObject<Map<string, string>>,
  commitSessionState: (s: EditorSessionState, opts?: { syncEditorDoc?: boolean }) => void,
) {
  const isPathOpen = useCallback(
    (path: string): boolean => hasSessionPath(stateRef.current, path),
    // stateRef is a stable ref object — no reactive dep needed
    [],
  );

  const handleDocChange = useCallback((doc: string) => {
    const path = stateRef.current.activePath;
    if (!path) return;
    liveDocs.current.set(path, doc);
    const isDirty = doc !== (buffers.current.get(path) ?? "");
    const nextState = markSessionTabDirty(stateRef.current, path, isDirty);
    if (nextState !== stateRef.current) commitSessionState(nextState, { syncEditorDoc: false });
  }, [commitSessionState, stateRef, buffers, liveDocs]);

  const switchToTab = useCallback(
    (path: string) => commitSessionState(activateSessionTab(stateRef.current, path)),
    [commitSessionState, stateRef],
  );

  const reorderTabs = useCallback(
    (tabs: Tab[]) => commitSessionState(reorderSessionTabs(stateRef.current, tabs)),
    [commitSessionState, stateRef],
  );

  const renameBuffers = useCallback((oldPath: string, newPath: string) => {
    const content = buffers.current.get(oldPath);
    if (content !== undefined) { buffers.current.delete(oldPath); buffers.current.set(newPath, content); }
    const liveDoc = liveDocs.current.get(oldPath);
    if (liveDoc !== undefined) { liveDocs.current.delete(oldPath); liveDocs.current.set(newPath, liveDoc); }
    commitSessionState(renameSessionTab(stateRef.current, oldPath, newPath, basename(newPath)));
  }, [commitSessionState, stateRef, buffers, liveDocs]);

  const pinTab = useCallback(
    (path: string) => commitSessionState(pinSessionTab(stateRef.current, path)),
    [commitSessionState, stateRef],
  );

  return { isPathOpen, handleDocChange, switchToTab, reorderTabs, renameBuffers, pinTab };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEditorSession({
  fs,
  refreshTree,
  addRecentFile,
}: EditorSessionDeps): UseEditorSessionReturn {
  const {
    sessionState, editorDoc, setEditorDoc,
    buffers, liveDocs, stateRef, openFileRequestRef,
    commitSessionState, getSessionState,
  } = useSessionStateCore();

  const {
    isPathOpen, handleDocChange, switchToTab, reorderTabs, renameBuffers, pinTab,
  } = useTabCallbacks(stateRef, buffers, liveDocs, commitSessionState);

  const openFile = useCallback(async (path: string, options?: { preview?: boolean }) => {
    await executeOpenFile(
      path, options, fs, stateRef, buffers, liveDocs,
      openFileRequestRef, addRecentFile, commitSessionState,
    );
  }, [addRecentFile, commitSessionState, fs, stateRef, buffers, liveDocs, openFileRequestRef]);

  const openFileWithContent = useCallback((name: string, content: string) => {
    let path = name;
    let suffix = 1;
    while (hasSessionPath(stateRef.current, path)) { path = `${name} (${suffix++})`; }
    buffers.current.set(path, "");
    liveDocs.current.set(path, content);
    commitSessionState(openSessionTab(stateRef.current, {
      path, name: basename(path), dirty: true, preview: false,
    }));
  }, [commitSessionState, stateRef, buffers, liveDocs]);

  const fileOps = useFileOperations({
    fs, refreshTree, addRecentFile, getSessionState,
    buffers, liveDocs, commitSessionState, openFile, renameBuffers,
    skipDirtyConfirm: import.meta.env.DEV,
  });

  return {
    openTabs: sessionState.tabs,
    activeTab: sessionState.activePath,
    editorDoc, setEditorDoc, buffers, liveDocs,
    isPathOpen, handleDocChange, switchToTab, reorderTabs, renameBuffers,
    openFile, openFileWithContent, pinTab,
    ...fileOps,
  };
}
