/**
 * useFileOperations — filesystem mutation callbacks extracted from useEditorSession.
 *
 * Handles save, create, delete, rename, close, and save-as. All callbacks
 * are stable (useCallback) and share the sessionStateRef / buffers / liveDocs
 * refs passed in from useEditorSession.
 */

import { useCallback } from "react";
import type { RefObject } from "react";
import type { FileSystem } from "../file-manager";
import { isTauri } from "../tauri-fs";
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
  sessionStateRef: RefObject<EditorSessionState>;
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

export function useFileOperations({
  fs,
  refreshTree,
  addRecentFile,
  sessionStateRef,
  buffers,
  liveDocs,
  commitSessionState,
  openFile,
  renameBuffers,
}: FileOperationsDeps): UseFileOperationsReturn {
  const saveFile = useCallback(async () => {
    const path = sessionStateRef.current.activePath;
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
  }, [commitSessionState, fs, liveDocs, buffers, sessionStateRef]);

  const createFile = useCallback(async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file",
        detail: path,
      });
      await Promise.all([refreshTree(), openFile(path)]);
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
  }, [commitSessionState, sessionStateRef, buffers, liveDocs]);

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
  }, [commitSessionState, fs, refreshTree, sessionStateRef, buffers, liveDocs]);

  const saveAs = useCallback(async () => {
    const path = sessionStateRef.current.activePath;
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
  }, [addRecentFile, commitSessionState, fs, refreshTree, sessionStateRef, buffers, liveDocs]);

  return {
    saveFile,
    createFile,
    createDirectory,
    closeFile,
    handleRename,
    handleDelete,
    saveAs,
  };
}
