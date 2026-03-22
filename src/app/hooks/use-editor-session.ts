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
import { measureAsync, withPerfOperation } from "../perf";

export interface EditorSessionDeps {
  fs: FileSystem;
  refreshTree: () => Promise<void>;
  addRecentFile: (path: string) => void;
}

export interface UseEditorSessionReturn {
  openTabs: Tab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  activeTab: string | null;
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
  editorDoc: string;
  setEditorDoc: React.Dispatch<React.SetStateAction<string>>;
  buffers: React.RefObject<Map<string, string>>;
  liveDocs: React.RefObject<Map<string, string>>;
  openPathsRef: React.RefObject<Set<string>>;
  activeTabRef: React.RefObject<string | null>;
  handleDocChange: (doc: string) => void;
  switchToTab: (path: string) => void;
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
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editorDoc, setEditorDoc] = useState("");

  const buffers = useRef<Map<string, string>>(new Map());
  const liveDocs = useRef<Map<string, string>>(new Map());
  const openPathsRef = useRef<Set<string>>(new Set());
  const activeTabRef = useRef<string | null>(null);

  useEffect(() => {
    openPathsRef.current = new Set(openTabs.map((tab) => tab.path));
  }, [openTabs]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const docForPath = useCallback((path: string | null): string => {
    if (!path) return "";
    return liveDocs.current.get(path) ?? buffers.current.get(path) ?? "";
  }, []);

  const handleDocChange = useCallback((doc: string) => {
    const path = activeTabRef.current;
    if (!path) return;
    liveDocs.current.set(path, doc);

    const isDirty = doc !== (buffers.current.get(path) ?? "");
    setOpenTabs((prev) => {
      const tab = prev.find((candidate) => candidate.path === path);
      if (!tab) return prev;
      const shouldPin = isDirty && tab.preview;
      if (tab.dirty === isDirty && !shouldPin) return prev;
      return prev.map((candidate) =>
        candidate.path === path
          ? {
              ...candidate,
              dirty: isDirty,
              ...(shouldPin ? { preview: false } : {}),
            }
          : candidate,
      );
    });
  }, []);

  const switchToTab = useCallback((path: string) => {
    setActiveTab(path);
    setEditorDoc(docForPath(path));
  }, [docForPath]);

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

    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.path === oldPath ? { ...tab, path: newPath, name: basename(newPath) } : tab,
      ),
    );

    if (activeTabRef.current === oldPath) {
      setActiveTab(newPath);
    }
  }, []);

  const pinTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const tab = prev.find((candidate) => candidate.path === path);
      if (!tab || !tab.preview) return prev;
      return prev.map((candidate) =>
        candidate.path === path ? { ...candidate, preview: false } : candidate,
      );
    });
  }, []);

  const openFile = useCallback(async (path: string, options?: { preview?: boolean }) => {
    const isPreview = options?.preview ?? false;

    await withPerfOperation("open_file", async (operation) => {
      if (openPathsRef.current.has(path)) {
        operation.measureSync("open_file.activate", () => {
          setActiveTab(path);
          setEditorDoc(docForPath(path));
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
              const previewIdx = prev.findIndex((tab) => tab.preview);
              if (previewIdx !== -1) {
                const oldPreview = prev[previewIdx];
                buffers.current.delete(oldPreview.path);
                liveDocs.current.delete(oldPreview.path);
                const next = [...prev];
                next[previewIdx] = {
                  path,
                  name: basename(path),
                  dirty: false,
                  preview: true,
                };
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
        // Silently ignore unreadable files.
      }
    }, path);
  }, [addRecentFile, docForPath, fs, pinTab]);

  const openFileWithContent = useCallback((name: string, content: string) => {
    let path = name;
    let suffix = 1;
    while (openPathsRef.current.has(path)) {
      path = `${name} (${suffix++})`;
    }

    buffers.current.set(path, "");
    liveDocs.current.set(path, content);

    setOpenTabs((prev) => [...prev, {
      path,
      name: basename(path),
      dirty: true,
      preview: false,
    }]);
    setActiveTab(path);
    setEditorDoc(content);
  }, []);

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
        prev.map((tab) => (tab.path === path ? { ...tab, dirty: false } : tab)),
      );
    } catch {
      // Save failed — leave dirty.
    }
  }, [fs]);

  const createFile = useCallback(async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file",
        detail: path,
      });
      await refreshTree();
      await openFile(path);
    } catch {
      // File may already exist.
    }
  }, [fs, openFile, refreshTree]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await measureAsync("create_directory.write", () => fs.createDirectory(path), {
        category: "create_directory",
        detail: path,
      });
      await refreshTree();
    } catch {
      // Directory may already exist.
    }
  }, [fs, refreshTree]);

  const closeFile = useCallback(async (path: string) => {
    const tab = openTabs.find((candidate) => candidate.path === path);
    if (tab?.dirty) {
      const answer = window.confirm(
        `"${tab.name}" has unsaved changes.\n\nPress OK to discard, or Cancel to keep editing.`,
      );
      if (!answer) return;
    }

    const remaining = openTabs.filter((candidate) => candidate.path !== path);

    setOpenTabs((prev) => prev.filter((candidate) => candidate.path !== path));

    if (path === activeTabRef.current) {
      setTimeout(() => {
        const nextPath = remaining[0]?.path ?? null;
        setActiveTab(nextPath);
        setEditorDoc(docForPath(nextPath));
      }, 0);
    }

    buffers.current.delete(path);
    liveDocs.current.delete(path);
  }, [docForPath, openTabs]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();
      renameBuffers(oldPath, newPath);
    } catch {
      // Rename failed.
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
      // deleteFile may not be supported.
    }

    const prefix = path + "/";
    const isAffected = (candidate: string) => candidate === path || candidate.startsWith(prefix);

    setOpenTabs((prev) => {
      const affected = new Set(prev.filter((tab) => isAffected(tab.path)).map((tab) => tab.path));
      if (affected.size === 0) return prev;

      for (const affectedPath of affected) {
        buffers.current.delete(affectedPath);
        liveDocs.current.delete(affectedPath);
      }

      const remaining = prev.filter((tab) => !affected.has(tab.path));
      if (affected.has(activeTabRef.current ?? "")) {
        const nextPath = remaining[0]?.path ?? null;
        setActiveTab(nextPath);
        setEditorDoc(docForPath(nextPath));
      }
      return remaining;
    });

    await refreshTree();
  }, [docForPath, fs, refreshTree]);

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
        // Save dialog failed or was cancelled.
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
  }, [addRecentFile, fs]);

  return {
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    openPathsRef,
    activeTabRef,
    handleDocChange,
    switchToTab,
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
