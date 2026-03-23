/**
 * useEditorSession — unified tab/buffer lifecycle and file operations.
 *
 * Owns in-memory document session state (tabs, buffers, dirty tracking) and
 * delegates filesystem mutation callbacks to useFileOperations. Editor shell
 * consumers get a single stable object from this hook.
 *
 * State management notes:
 * - sessionStateRef is an eagerly-updated mirror of sessionState used by
 *   callbacks to avoid stale closure reads. It is NOT exported; callers use
 *   the derived React state (openTabs, activeTab) or stable callbacks instead.
 * - openPathsRef and activeTabRef are internal implementation details;
 *   callers use isPathOpen() instead of reaching into a ref directly.
 */

import { useCallback, useRef, useState } from "react";
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

export function useEditorSession({
  fs,
  refreshTree,
  addRecentFile,
}: EditorSessionDeps): UseEditorSessionReturn {
  const [sessionState, setSessionState] = useState<EditorSessionState>(() => createEditorSessionState());
  const [editorDoc, setEditorDoc] = useState("");

  const buffers = useRef<Map<string, string>>(new Map());
  const liveDocs = useRef<Map<string, string>>(new Map());
  // Eagerly-updated mirror of React state; allows callbacks to read the
  // latest session without depending on React's asynchronous update cycle.
  const sessionStateRef = useRef<EditorSessionState>(sessionState);
  const openFileRequestRef = useRef(0);

  const openTabs = sessionState.tabs;
  const activeTab = sessionState.activePath;

  const docForPath = useCallback((path: string | null): string => {
    if (!path) return "";
    return liveDocs.current.get(path) ?? buffers.current.get(path) ?? "";
  }, []);

  const commitSessionState = useCallback((
    nextState: EditorSessionState,
    options?: { syncEditorDoc?: boolean },
  ) => {
    const shouldSyncEditorDoc = options?.syncEditorDoc
      ?? nextState.activePath !== sessionStateRef.current.activePath;
    // Update the ref eagerly so subsequent synchronous reads within the same
    // event tick see the new state before React re-renders.
    sessionStateRef.current = nextState;
    setSessionState(nextState);
    if (shouldSyncEditorDoc) {
      setEditorDoc(docForPath(nextState.activePath));
    }
  }, [docForPath]);

  const isPathOpen = useCallback((path: string): boolean => {
    return hasSessionPath(sessionStateRef.current, path);
  }, []);

  const handleDocChange = useCallback((doc: string) => {
    const path = sessionStateRef.current.activePath;
    if (!path) return;
    liveDocs.current.set(path, doc);

    const isDirty = doc !== (buffers.current.get(path) ?? "");
    const nextState = markSessionTabDirty(sessionStateRef.current, path, isDirty);
    if (nextState !== sessionStateRef.current) {
      commitSessionState(nextState, { syncEditorDoc: false });
    }
  }, [commitSessionState]);

  const switchToTab = useCallback((path: string) => {
    commitSessionState(activateSessionTab(sessionStateRef.current, path));
  }, [commitSessionState]);

  const reorderTabs = useCallback((tabs: Tab[]) => {
    commitSessionState(reorderSessionTabs(sessionStateRef.current, tabs));
  }, [commitSessionState]);

  const renameBuffers = useCallback((oldPath: string, newPath: string) => {
    const content = buffers.current.get(oldPath);
    if (content !== undefined) {
      buffers.current.delete(oldPath);
      buffers.current.set(newPath, content);
    }

    const liveDoc = liveDocs.current.get(oldPath);
    if (liveDoc !== undefined) {
      liveDocs.current.delete(oldPath);
      liveDocs.current.set(newPath, liveDoc);
    }

    commitSessionState(
      renameSessionTab(sessionStateRef.current, oldPath, newPath, basename(newPath)),
    );
  }, [commitSessionState]);

  const pinTab = useCallback((path: string) => {
    commitSessionState(pinSessionTab(sessionStateRef.current, path));
  }, [commitSessionState]);

  const openFile = useCallback(async (path: string, options?: { preview?: boolean }) => {
    const isPreview = options?.preview ?? false;
    const requestId = ++openFileRequestRef.current;

    await withPerfOperation("open_file", async (operation) => {
      if (hasSessionPath(sessionStateRef.current, path)) {
        operation.measureSync("open_file.activate", () => {
          if (requestId !== openFileRequestRef.current) return;
          const existing = findSessionTab(sessionStateRef.current, path);
          if (!existing) return;
          commitSessionState(openSessionTab(sessionStateRef.current, {
            path,
            name: existing.name,
            dirty: existing.dirty,
            preview: isPreview,
          }));
          addRecentFile(path);
        }, { category: "open_file", detail: path });
        return;
      }

      try {
        const content = await operation.measureAsync("open_file.read", () => fs.readFile(path), {
          category: "open_file",
          detail: path,
        });

        operation.measureSync("open_file.tab_state", () => {
          if (requestId !== openFileRequestRef.current) return;
          const currentState = sessionStateRef.current;
          const replacedPreview = isPreview ? findPreviewTab(currentState) : undefined;
          buffers.current.set(path, content);
          liveDocs.current.set(path, content);
          if (replacedPreview && replacedPreview.path !== path) {
            buffers.current.delete(replacedPreview.path);
            liveDocs.current.delete(replacedPreview.path);
          }
          commitSessionState(openSessionTab(currentState, {
            path,
            name: basename(path),
            dirty: false,
            preview: isPreview,
          }));
          addRecentFile(path);
        }, { category: "open_file", detail: path });
      } catch (e: unknown) {
        console.error("[session] failed to open file:", path, e);
      }
    }, path);
  }, [addRecentFile, commitSessionState, fs]);

  const openFileWithContent = useCallback((name: string, content: string) => {
    let path = name;
    let suffix = 1;
    // Derive open paths from the ref to avoid stale closure reads.
    while (hasSessionPath(sessionStateRef.current, path)) {
      path = `${name} (${suffix++})`;
    }

    buffers.current.set(path, "");
    liveDocs.current.set(path, content);

    commitSessionState(openSessionTab(sessionStateRef.current, {
      path,
      name: basename(path),
      dirty: true,
      preview: false,
    }));
  }, [commitSessionState]);

  const fileOps = useFileOperations({
    fs,
    refreshTree,
    addRecentFile,
    sessionStateRef,
    buffers,
    liveDocs,
    commitSessionState,
    openFile,
    renameBuffers,
  });

  return {
    openTabs,
    activeTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    isPathOpen,
    handleDocChange,
    switchToTab,
    reorderTabs,
    renameBuffers,
    openFile,
    openFileWithContent,
    pinTab,
    ...fileOps,
  };
}
