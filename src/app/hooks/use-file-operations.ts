/**
 * useFileOperations — file open/save/close/rename/delete operations.
 *
 * Extracted from AppInner. Operates on the document buffer (tabs, buffers,
 * liveDocs) and the filesystem. All async file I/O is encapsulated here.
 */

import { useCallback } from "react";
import type { FileSystem } from "../file-manager";
import type { Tab } from "../tab-bar";
import { isTauri } from "../tauri-fs";
import { basename } from "../lib/utils";

export interface FileOperationsDeps {
  fs: FileSystem;
  /** Ref-backed set of currently open paths. */
  openPathsRef: React.RefObject<Set<string>>;
  /** Ref mirror of activeTab. */
  activeTabRef: React.RefObject<string | null>;
  /** path -> raw file content. */
  buffers: React.RefObject<Map<string, string>>;
  /** path -> live editor doc content. */
  liveDocs: React.RefObject<Map<string, string>>;
  /** Current open tabs (for closeFile dirty check). */
  openTabs: Tab[];
  /** State setters from useDocumentBuffer. */
  setOpenTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
  setEditorDoc: React.Dispatch<React.SetStateAction<string>>;
  /** Rename buffer entries from old to new path. */
  renameBuffers: (oldPath: string, newPath: string) => void;
  /** Refresh the file tree after mutations. */
  refreshTree: () => Promise<void>;
  /** Track recently opened files. */
  addRecentFile: (path: string) => void;
}

export interface UseFileOperationsReturn {
  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeFile: (path: string) => Promise<void>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
}

export function useFileOperations(deps: FileOperationsDeps): UseFileOperationsReturn {
  const {
    fs,
    openPathsRef,
    activeTabRef,
    buffers,
    liveDocs,
    openTabs,
    setOpenTabs,
    setActiveTab,
    setEditorDoc,
    renameBuffers,
    refreshTree,
    addRecentFile,
  } = deps;

  const openFile = useCallback(async (path: string) => {
    // If already open, just activate.
    if (openPathsRef.current.has(path)) {
      setActiveTab(path);
      setEditorDoc(liveDocs.current.get(path) ?? buffers.current.get(path) ?? "");
      addRecentFile(path);
      return;
    }

    try {
      const content = await fs.readFile(path);
      buffers.current.set(path, content);
      liveDocs.current.set(path, content);

      setOpenTabs((prev) => [...prev, { path, name: basename(path), dirty: false }]);
      setActiveTab(path);
      setEditorDoc(content);
      addRecentFile(path);
    } catch {
      // Silently ignore unreadable files
    }
  }, [fs, addRecentFile, openPathsRef, buffers, liveDocs, setOpenTabs, setActiveTab, setEditorDoc]);

  const saveFile = useCallback(async () => {
    const path = activeTabRef.current;
    if (!path) return;

    const doc = liveDocs.current.get(path) ?? "";
    try {
      await fs.writeFile(path, doc);
      buffers.current.set(path, doc);
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)),
      );
    } catch {
      // Save failed — leave dirty
    }
  }, [fs, activeTabRef, liveDocs, buffers, setOpenTabs]);

  const createFile = useCallback(async (path: string) => {
    try {
      await fs.createFile(path, "");
      await refreshTree();
      await openFile(path);
    } catch {
      // File may already exist
    }
  }, [fs, refreshTree, openFile]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await fs.createDirectory(path);
      await refreshTree();
    } catch {
      // Directory may already exist
    }
  }, [fs, refreshTree]);

  const closeFile = useCallback(async (path: string) => {
    // Save-before-close: ask if tab is dirty
    const tab = openTabs.find((t) => t.path === path);
    if (tab?.dirty) {
      const answer = window.confirm(
        `"${tab.name}" has unsaved changes.\n\nPress OK to discard, or Cancel to keep editing.`
      );
      if (!answer) return;
    }

    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      return prev.filter((t) => t.path !== path);
    });

    if (path === activeTabRef.current) {
      setTimeout(() => {
        const remaining = openTabs.filter((t) => t.path !== path);
        const nextPath = remaining[0]?.path ?? null;
        setActiveTab(nextPath);
        setEditorDoc(
          nextPath
            ? (liveDocs.current.get(nextPath) ?? buffers.current.get(nextPath) ?? "")
            : "",
        );
      }, 0);
    }

    buffers.current.delete(path);
    liveDocs.current.delete(path);
  }, [openTabs, activeTabRef, liveDocs, buffers, setOpenTabs, setActiveTab, setEditorDoc]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();
      renameBuffers(oldPath, newPath);
    } catch {
      // Rename failed
    }
  }, [fs, refreshTree, renameBuffers]);

  const handleDelete = useCallback(async (path: string) => {
    const ok = window.confirm(`Delete "${basename(path)}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await fs.deleteFile(path);
    } catch {
      // deleteFile may not be supported
    }
    // Close the exact file, or all children if it was a directory
    const prefix = path + "/";
    const isAffected = (p: string) => p === path || p.startsWith(prefix);
    setOpenTabs((prev) => {
      const affected = new Set(prev.filter((t) => isAffected(t.path)).map((t) => t.path));
      if (affected.size === 0) return prev;
      for (const p of affected) {
        buffers.current.delete(p);
        liveDocs.current.delete(p);
      }
      const remaining = prev.filter((t) => !affected.has(t.path));
      if (affected.has(activeTabRef.current ?? "")) {
        const nextPath = remaining[0]?.path ?? null;
        setActiveTab(nextPath);
        setEditorDoc(
          nextPath
            ? (liveDocs.current.get(nextPath) ?? buffers.current.get(nextPath) ?? "")
            : "",
        );
      }
      return remaining;
    });
    await refreshTree();
  }, [fs, refreshTree, activeTabRef, buffers, liveDocs, setOpenTabs, setActiveTab, setEditorDoc]);

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
        await fs.writeFile(savePath, doc);
        addRecentFile(savePath);
      } catch {
        // Save dialog failed or was cancelled
      }
    } else {
      const blob = new Blob([doc], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = basename(path);
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [fs, addRecentFile, activeTabRef, liveDocs]);

  return {
    openFile,
    saveFile,
    createFile,
    createDirectory,
    closeFile,
    handleRename,
    handleDelete,
    saveAs,
  };
}
