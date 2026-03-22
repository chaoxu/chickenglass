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
import { measureAsync, withPerfOperation } from "../perf";
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
  openFile: (path: string, options?: { preview?: boolean }) => Promise<void>;
  /** Open an external file by content string, creating a dirty unsaved buffer. */
  openFileWithContent: (name: string, content: string) => void;
  saveFile: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeFile: (path: string) => Promise<void>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
  /** Pin a preview tab (mark preview: false). */
  pinTab: (path: string) => void;
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

  const pinTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const tab = prev.find((t) => t.path === path);
      if (!tab || !tab.preview) return prev;
      return prev.map((t) => (t.path === path ? { ...t, preview: false } : t));
    });
  }, [setOpenTabs]);

  const openFile = useCallback(async (path: string, options?: { preview?: boolean }) => {
    const isPreview = options?.preview ?? false;

    await withPerfOperation("open_file", async (operation) => {
      if (openPathsRef.current.has(path)) {
        operation.measureSync("open_file.activate", () => {
          setActiveTab(path);
          setEditorDoc(liveDocs.current.get(path) ?? buffers.current.get(path) ?? "");
          if (!isPreview) {
            pinTab(path);
          }
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
          buffers.current.set(path, content);
          liveDocs.current.set(path, content);

          setOpenTabs((prev) => {
            if (isPreview) {
              const previewIdx = prev.findIndex((t) => t.preview);
              if (previewIdx !== -1) {
                const oldPreview = prev[previewIdx];
                buffers.current.delete(oldPreview.path);
                liveDocs.current.delete(oldPreview.path);
                const next = [...prev];
                next[previewIdx] = { path, name: basename(path), dirty: false, preview: true };
                return next;
              }
            }
            return [...prev, { path, name: basename(path), dirty: false, preview: isPreview }];
          });
          setActiveTab(path);
          setEditorDoc(content);
          addRecentFile(path);
        }, { category: "open_file", detail: path });
      } catch {
        // Silently ignore unreadable files
      }
    }, path);
  }, [fs, addRecentFile, openPathsRef, buffers, liveDocs, setOpenTabs, setActiveTab, setEditorDoc, pinTab]);

  const openFileWithContent = useCallback((name: string, content: string) => {
    // Use the filename as a synthetic path; add a unique suffix if a tab with
    // the same name is already open so we don't collide.
    let path = name;
    let suffix = 1;
    while (openPathsRef.current.has(path)) {
      path = `${name} (${suffix++})`;
    }

    // Store the content in the live buffer. The buffer (saved copy) is left
    // empty so the tab is immediately considered dirty.
    buffers.current.set(path, "");
    liveDocs.current.set(path, content);

    setOpenTabs((prev) => [...prev, { path, name: basename(path), dirty: true, preview: false }]);
    setActiveTab(path);
    setEditorDoc(content);
  }, [openPathsRef, buffers, liveDocs, setOpenTabs, setActiveTab, setEditorDoc]);

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
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)),
      );
    } catch {
      // Save failed — leave dirty
    }
  }, [fs, activeTabRef, liveDocs, buffers, setOpenTabs]);

  const createFile = useCallback(async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file",
        detail: path,
      });
      await refreshTree();
      await openFile(path);
    } catch {
      // File may already exist
    }
  }, [fs, refreshTree, openFile]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await measureAsync("create_directory.write", () => fs.createDirectory(path), {
        category: "create_directory",
        detail: path,
      });
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

    // Compute remaining tabs before calling setOpenTabs to avoid stale closure in setTimeout
    const remaining = openTabs.filter((t) => t.path !== path);

    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      return prev.filter((t) => t.path !== path);
    });

    if (path === activeTabRef.current) {
      setTimeout(() => {
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
      await measureAsync("delete_file.write", () => fs.deleteFile(path), {
        category: "delete_file",
        detail: path,
      });
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
