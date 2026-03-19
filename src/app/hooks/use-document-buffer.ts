/**
 * useDocumentBuffer — manages the in-memory document buffers, open tabs,
 * active tab selection, and dirty-state tracking.
 *
 * Extracted from AppInner to isolate tab/buffer lifecycle from the rest
 * of the application state.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Tab } from "../tab-bar";

/** Return the file name portion of a path (last segment after "/"). */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export interface UseDocumentBufferReturn {
  /** Currently open tabs. */
  openTabs: Tab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  /** Path of the active tab, or null. */
  activeTab: string | null;
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
  /** The doc string passed to EditorPane. */
  editorDoc: string;
  setEditorDoc: React.Dispatch<React.SetStateAction<string>>;
  /** path -> raw file content (for FS save). */
  buffers: React.RefObject<Map<string, string>>;
  /** path -> in-editor doc string (live, may include expanded includes). */
  liveDocs: React.RefObject<Map<string, string>>;
  /** Ref mirror of openTabs paths. */
  openPathsRef: React.RefObject<Set<string>>;
  /** Ref mirror of activeTab. */
  activeTabRef: React.RefObject<string | null>;
  /** Handle a doc change from the editor — marks tab dirty when content diverges. */
  handleDocChange: (doc: string) => void;
  /** Switch to an already-open tab by path. */
  switchToTab: (path: string) => void;
  /** Move buffer/liveDoc entries from oldPath to newPath and update tabs. */
  renameBuffers: (oldPath: string, newPath: string) => void;
  /** Clean up buffers/liveDocs for a path. */
  deleteBuffers: (path: string) => void;
  /** Mark the active tab as clean (after save). */
  markClean: (path: string) => void;
}

export function useDocumentBuffer(): UseDocumentBufferReturn {
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editorDoc, setEditorDoc] = useState("");

  /** path -> raw file content (for FS save) */
  const buffers = useRef<Map<string, string>>(new Map());
  /** path -> in-editor doc string (live, may include expanded includes) */
  const liveDocs = useRef<Map<string, string>>(new Map());
  /** Ref mirror of openTabs paths — avoids closing over stale openTabs in openFile. */
  const openPathsRef = useRef<Set<string>>(new Set());
  /** Ref mirror of activeTab — avoids stale closure in handleDocChange. */
  const activeTabRef = useRef<string | null>(null);

  // Sync ref mirrors whenever state updates.
  useEffect(() => {
    openPathsRef.current = new Set(openTabs.map((t) => t.path));
  }, [openTabs]);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Track doc changes to mark tab dirty.
  const handleDocChange = useCallback((doc: string) => {
    const path = activeTabRef.current;
    if (!path) return;
    liveDocs.current.set(path, doc);

    const isDirty = doc !== (buffers.current.get(path) ?? "");
    setOpenTabs((prev) => {
      const tab = prev.find((t) => t.path === path);
      if (!tab || tab.dirty === isDirty) return prev;
      return prev.map((t) => (t.path === path ? { ...t, dirty: isDirty } : t));
    });
  }, []);

  const switchToTab = useCallback((path: string) => {
    setActiveTab(path);
    setEditorDoc(liveDocs.current.get(path) ?? buffers.current.get(path) ?? "");
  }, []);

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
      prev.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, name: basename(newPath) } : t,
      ),
    );
    if (activeTabRef.current === oldPath) {
      setActiveTab(newPath);
    }
  }, []);

  const deleteBuffers = useCallback((path: string) => {
    buffers.current.delete(path);
    liveDocs.current.delete(path);
  }, []);

  const markClean = useCallback((path: string) => {
    const doc = liveDocs.current.get(path) ?? "";
    buffers.current.set(path, doc);
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)),
    );
  }, []);

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
    deleteBuffers,
    markClean,
  };
}
