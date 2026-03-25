/**
 * useFileOperations — filesystem mutation callbacks extracted from useEditorSession.
 *
 * Handles save, create, delete, rename, close, and save-as. All callbacks
 * are stable (useCallback) and share the getSessionState getter / buffers /
 * liveDocs refs passed in from useEditorSession.
 *
 * Internal structure:
 * - executeSaveAs / executeHandleDeleteCleanup — pure async helpers
 * - useSaveCallbacks — saveFile, saveAs
 * - useMutationCallbacks — createFile, createDirectory, closeFile, handleRename, handleDelete
 */

import { useCallback } from "react";
import type { RefObject } from "react";
import type { FileSystem } from "../file-manager";
import { isTauri } from "../../lib/tauri";
import { basename } from "../lib/utils";
import { toProjectRelativePathCommand } from "../tauri-client/fs";
import { measureAsync } from "../perf";
import { applySaveAsResult } from "../editor-session-save";
import {
  closeSessionTab,
  closeSessionTabs,
  markSessionTabDirty,
} from "../editor-session-actions";
import {
  findSessionTab,
  type EditorSessionState,
} from "../editor-session-model";

export interface FileOperationsDeps {
  fs: FileSystem;
  refreshTree: () => Promise<void>;
  addRecentFile: (path: string) => void;
  /** Stable getter that always returns the latest session state. */
  getSessionState: () => EditorSessionState;
  buffers: RefObject<Map<string, string>>;
  liveDocs: RefObject<Map<string, string>>;
  commitSessionState: (
    nextState: EditorSessionState,
    options?: { syncEditorDoc?: boolean },
  ) => void;
  openFile: (path: string, options?: { preview?: boolean }) => Promise<void>;
  renameBuffers: (oldPath: string, newPath: string) => void;
}

export interface UseFileOperationsReturn {
  saveFile: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeFile: (path: string) => Promise<void>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Module-private async helpers
// ---------------------------------------------------------------------------

async function executeSaveAs(
  fs: FileSystem,
  refreshTree: () => Promise<void>,
  addRecentFile: (path: string) => void,
  getSessionState: () => EditorSessionState,
  buffers: RefObject<Map<string, string>>,
  liveDocs: RefObject<Map<string, string>>,
  commitSessionState: (s: EditorSessionState, opts?: { syncEditorDoc?: boolean }) => void,
): Promise<void> {
  const path = getSessionState().activePath;
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
      await (exists ? fs.writeFile(relativePath, doc) : fs.createFile(relativePath, doc));
      commitSessionState(applySaveAsResult({
        state: getSessionState(), buffers: buffers.current, liveDocs: liveDocs.current,
        oldPath: path, newPath: relativePath, doc,
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
}

function executeHandleDeleteCleanup(
  path: string,
  getSessionState: () => EditorSessionState,
  buffers: RefObject<Map<string, string>>,
  liveDocs: RefObject<Map<string, string>>,
  commitSessionState: (s: EditorSessionState) => void,
): void {
  const prefix = path + "/";
  const isAffected = (c: string) => c === path || c.startsWith(prefix);
  const affected = new Set(
    getSessionState().tabs.filter((t) => isAffected(t.path)).map((t) => t.path),
  );
  for (const p of affected) { buffers.current.delete(p); liveDocs.current.delete(p); }
  commitSessionState(closeSessionTabs(getSessionState(), affected));
}

// ---------------------------------------------------------------------------
// Internal sub-hooks (module-private)
// ---------------------------------------------------------------------------

function useSaveCallbacks(
  fs: FileSystem,
  refreshTree: () => Promise<void>,
  addRecentFile: (path: string) => void,
  getSessionState: () => EditorSessionState,
  buffers: RefObject<Map<string, string>>,
  liveDocs: RefObject<Map<string, string>>,
  commitSessionState: (s: EditorSessionState, opts?: { syncEditorDoc?: boolean }) => void,
) {
  const saveFile = useCallback(async () => {
    const path = getSessionState().activePath;
    if (!path) return;
    const doc = liveDocs.current.get(path) ?? "";
    try {
      await measureAsync("save_file.write", () => fs.writeFile(path, doc), {
        category: "save_file", detail: path,
      });
      buffers.current.set(path, doc);
      liveDocs.current.set(path, doc);
      commitSessionState(markSessionTabDirty(getSessionState(), path, false), { syncEditorDoc: false });
    } catch (e: unknown) {
      // Save failed — leave dirty so user knows data is unsaved
      console.error("[session] save failed:", e);
    }
  }, [commitSessionState, fs, liveDocs, buffers, getSessionState]);

  const saveAs = useCallback(async () => {
    await executeSaveAs(
      fs, refreshTree, addRecentFile, getSessionState, buffers, liveDocs, commitSessionState,
    );
  }, [addRecentFile, commitSessionState, fs, refreshTree, getSessionState, buffers, liveDocs]);

  return { saveFile, saveAs };
}

function useMutationCallbacks(
  fs: FileSystem,
  refreshTree: () => Promise<void>,
  getSessionState: () => EditorSessionState,
  buffers: RefObject<Map<string, string>>,
  liveDocs: RefObject<Map<string, string>>,
  commitSessionState: (s: EditorSessionState, opts?: { syncEditorDoc?: boolean }) => void,
  openFile: (path: string) => Promise<void>,
  renameBuffers: (oldPath: string, newPath: string) => void,
) {
  const createFile = useCallback(async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file", detail: path,
      });
      await Promise.all([refreshTree(), openFile(path)]);
    } catch (e: unknown) { console.error("[session] create file failed:", e); }
  }, [fs, openFile, refreshTree]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await measureAsync("create_directory.write", () => fs.createDirectory(path), {
        category: "create_directory", detail: path,
      });
      await refreshTree();
    } catch (e: unknown) { console.error("[session] create directory failed:", e); }
  }, [fs, refreshTree]);

  const closeFile = useCallback(async (path: string) => {
    const tab = findSessionTab(getSessionState(), path);
    if (tab?.dirty) {
      const answer = window.confirm(
        `"${tab.name}" has unsaved changes.\n\nPress OK to discard, or Cancel to keep editing.`,
      );
      if (!answer) return;
    }
    commitSessionState(closeSessionTab(getSessionState(), path));
    buffers.current.delete(path);
    liveDocs.current.delete(path);
  }, [commitSessionState, getSessionState, buffers, liveDocs]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();
      renameBuffers(oldPath, newPath);
    } catch (e: unknown) { console.error("[session] rename failed:", e); }
  }, [fs, refreshTree, renameBuffers]);

  const handleDelete = useCallback(async (path: string) => {
    const ok = window.confirm(`Delete "${basename(path)}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await measureAsync("delete_file.write", () => fs.deleteFile(path), {
        category: "delete_file", detail: path,
      });
    } catch (e: unknown) { console.error("[session] delete failed:", e); }
    executeHandleDeleteCleanup(path, getSessionState, buffers, liveDocs, commitSessionState);
    await refreshTree();
  }, [commitSessionState, fs, refreshTree, getSessionState, buffers, liveDocs]);

  return { createFile, createDirectory, closeFile, handleRename, handleDelete };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileOperations({
  fs,
  refreshTree,
  addRecentFile,
  getSessionState,
  buffers,
  liveDocs,
  commitSessionState,
  openFile,
  renameBuffers,
}: FileOperationsDeps): UseFileOperationsReturn {
  const { saveFile, saveAs } = useSaveCallbacks(
    fs, refreshTree, addRecentFile, getSessionState, buffers, liveDocs, commitSessionState,
  );
  const { createFile, createDirectory, closeFile, handleRename, handleDelete } =
    useMutationCallbacks(
      fs, refreshTree, getSessionState, buffers, liveDocs, commitSessionState,
      openFile, renameBuffers,
    );

  return { saveFile, createFile, createDirectory, closeFile, handleRename, handleDelete, saveAs };
}
