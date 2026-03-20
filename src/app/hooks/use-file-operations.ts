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
import { parseTable, formatTable } from "../../render/table-utils";

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

/**
 * Find and format all GFM pipe tables in a document string.
 *
 * A table is a sequence of lines where:
 * - Each line starts and ends with `|` (after trimming)
 * - The second line is a separator row (cells match /^:?-+:?$/)
 * - There are at least 2 lines (header + separator)
 */
function formatTablesInDocument(doc: string): string {
  const lines = doc.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if this line could be the start of a table (starts/ends with |)
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && i + 1 < lines.length) {
      // Look ahead: next line must be a separator row
      const sepTrimmed = lines[i + 1].trim();
      if (isSeparatorRow(sepTrimmed)) {
        // Collect the full table
        const tableLines: string[] = [lines[i], lines[i + 1]];
        let j = i + 2;
        while (j < lines.length) {
          const lt = lines[j].trim();
          if (lt.startsWith("|") && lt.endsWith("|")) {
            tableLines.push(lines[j]);
            j++;
          } else {
            break;
          }
        }

        // Parse and format
        const parsed = parseTable(tableLines);
        if (parsed) {
          const formatted = formatTable(parsed);
          for (const fl of formatted) {
            result.push(fl);
          }
        } else {
          // Couldn't parse — keep original lines
          for (const tl of tableLines) {
            result.push(tl);
          }
        }
        i = j;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join("\n");
}

/** Check if a trimmed line is a GFM table separator row. */
function isSeparatorRow(trimmed: string): boolean {
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  // Remove outer pipes and split by |
  const inner = trimmed.slice(1, -1);
  const cells = inner.split("|");
  if (cells.length === 0) return false;
  return cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
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

    // If already open, just activate. If opening as pinned, also pin.
    if (openPathsRef.current.has(path)) {
      setActiveTab(path);
      setEditorDoc(liveDocs.current.get(path) ?? buffers.current.get(path) ?? "");
      if (!isPreview) {
        pinTab(path);
      }
      addRecentFile(path);
      return;
    }

    try {
      const content = await fs.readFile(path);
      buffers.current.set(path, content);
      liveDocs.current.set(path, content);

      setOpenTabs((prev) => {
        if (isPreview) {
          // Replace existing preview tab if any
          const previewIdx = prev.findIndex((t) => t.preview);
          if (previewIdx !== -1) {
            const oldPreview = prev[previewIdx];
            // Clean up buffers for the old preview tab
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
    } catch {
      // Silently ignore unreadable files
    }
  }, [fs, addRecentFile, openPathsRef, buffers, liveDocs, setOpenTabs, setActiveTab, setEditorDoc, pinTab]);

  const saveFile = useCallback(async () => {
    const path = activeTabRef.current;
    if (!path) return;

    let doc = liveDocs.current.get(path) ?? "";

    // Format tables before writing
    doc = formatTablesInDocument(doc);

    try {
      await fs.writeFile(path, doc);
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
    pinTab,
  };
}
