/**
 * useEditorSession — unified tab/buffer lifecycle and file operations.
 *
 * Keeps the in-memory document session (tabs, buffers, dirty state) and the
 * filesystem mutations in a single hook so editor shell consumers do not need
 * to thread a large dependency object between separate hooks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileSystem } from "../file-manager";
import type { Tab } from "../tab-bar";
import { isTauri } from "../tauri-fs";
import { basename } from "../lib/utils";
import { toProjectRelativePathCommand } from "../tauri-client/fs";
import { measureAsync, withPerfOperation } from "../perf";
import { applySaveAsResult } from "../editor-session-save";
import {
  activateSessionTab,
  closeSessionTab,
  closeSessionTabs,
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
  openPathsRef: React.RefObject<Set<string>>;
  activeTabRef: React.RefObject<string | null>;
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
  const openPathsRef = useRef<Set<string>>(new Set());
  const activeTabRef = useRef<string | null>(null);
  const sessionStateRef = useRef<EditorSessionState>(sessionState);
  const openFileRequestRef = useRef(0);

  const openTabs = sessionState.tabs;
  const activeTab = sessionState.activePath;

  useEffect(() => {
    sessionStateRef.current = sessionState;
    openPathsRef.current = new Set(sessionState.tabs.map((tab) => tab.path));
    activeTabRef.current = sessionState.activePath;
  }, [sessionState]);

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
    sessionStateRef.current = nextState;
    openPathsRef.current = new Set(nextState.tabs.map((tab) => tab.path));
    activeTabRef.current = nextState.activePath;
    setSessionState(nextState);
    if (shouldSyncEditorDoc) {
      setEditorDoc(docForPath(nextState.activePath));
    }
  }, [docForPath]);

  const handleDocChange = useCallback((doc: string) => {
    const path = activeTabRef.current;
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
    while (openPathsRef.current.has(path)) {
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

  const saveFile = useCallback(async () => {
    const path = activeTabRef.current;
    if (!path) return;

    const doc = liveDocs.current.get(path) ?? "";

    try {
      await measureAsync("save_file.write", () => fs.writeFile(path, doc), {
        category: "save_file",
        detail: path,
      });
      buffers.current.set(path, doc);
      liveDocs.current.set(path, doc);
      commitSessionState(markSessionTabDirty(sessionStateRef.current, path, false), {
        syncEditorDoc: false,
      });
    } catch (e: unknown) {
      // Save failed — leave dirty so user knows data is unsaved
      console.error("[session] save failed:", e);
    }
  }, [commitSessionState, fs]);

  const createFile = useCallback(async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file",
        detail: path,
      });
      await refreshTree();
      await openFile(path);
    } catch (e: unknown) {
      console.error("[session] create file failed:", e);
    }
  }, [fs, openFile, refreshTree]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await measureAsync("create_directory.write", () => fs.createDirectory(path), {
        category: "create_directory",
        detail: path,
      });
      await refreshTree();
    } catch (e: unknown) {
      console.error("[session] create directory failed:", e);
    }
  }, [fs, refreshTree]);

  const closeFile = useCallback(async (path: string) => {
    const tab = findSessionTab(sessionStateRef.current, path);
    if (tab?.dirty) {
      const answer = window.confirm(
        `"${tab.name}" has unsaved changes.\n\nPress OK to discard, or Cancel to keep editing.`,
      );
      if (!answer) return;
    }

    commitSessionState(closeSessionTab(sessionStateRef.current, path));
    buffers.current.delete(path);
    liveDocs.current.delete(path);
  }, [commitSessionState]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();
      renameBuffers(oldPath, newPath);
    } catch (e: unknown) {
      console.error("[session] rename failed:", e);
    }
  }, [fs, refreshTree, renameBuffers]);

  const handleDelete = useCallback(async (path: string) => {
    const ok = window.confirm(`Delete "${basename(path)}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await measureAsync("delete_file.write", () => fs.deleteFile(path), {
        category: "delete_file",
        detail: path,
      });
    } catch (e: unknown) {
      console.error("[session] delete failed:", e);
    }

    const prefix = path + "/";
    const isAffected = (candidate: string) => candidate === path || candidate.startsWith(prefix);

    const affected = new Set(
      sessionStateRef.current.tabs
        .filter((tab) => isAffected(tab.path))
        .map((tab) => tab.path),
    );
    for (const affectedPath of affected) {
      buffers.current.delete(affectedPath);
      liveDocs.current.delete(affectedPath);
    }
    commitSessionState(closeSessionTabs(sessionStateRef.current, affected));

    await refreshTree();
  }, [commitSessionState, fs, refreshTree]);

  const saveAs = useCallback(async () => {
    const path = activeTabRef.current;
    if (!path) return;
    const doc = liveDocs.current.get(path) ?? "";

    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const savePath = await save({
          defaultPath: path,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!savePath) return;
        const relativePath = await toProjectRelativePathCommand(savePath);
        const exists = await fs.exists(relativePath);
        if (exists) {
          await fs.writeFile(relativePath, doc);
        } else {
          await fs.createFile(relativePath, doc);
        }
        commitSessionState(applySaveAsResult({
          state: sessionStateRef.current,
          buffers: buffers.current,
          liveDocs: liveDocs.current,
          oldPath: path,
          newPath: relativePath,
          doc,
        }));
        addRecentFile(relativePath);
        await refreshTree();
      } catch {
        // best-effort: save-as dialog cancelled or failed by user action
      }
      return;
    }

    const blob = new Blob([doc], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = basename(path);
    anchor.click();
    URL.revokeObjectURL(url);
  }, [addRecentFile, commitSessionState, fs, refreshTree]);

  return {
    openTabs,
    activeTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    openPathsRef,
    activeTabRef,
    handleDocChange,
    switchToTab,
    reorderTabs,
    renameBuffers,
    openFile,
    openFileWithContent,
    saveFile,
    createFile,
    createDirectory,
    closeFile,
    handleRename,
    handleDelete,
    saveAs,
    pinTab,
  };
}
