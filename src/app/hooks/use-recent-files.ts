/**
 * useRecentFiles — React hook for tracking recently opened files and folders.
 *
 * Wraps the vanilla recent-files.ts module with a reactive React interface.
 * Exposes the current lists and mutating helpers that update both localStorage
 * and the in-memory state together.
 */

import { useState, useCallback } from "react";
import {
  getRecentFiles,
  getRecentFolders,
  recordRecentFile,
  recordRecentFolder,
  removeRecentEntry,
  clearRecentFiles,
  clearRecentFolders,
} from "../recent-files";

export interface UseRecentFilesReturn {
  /** Last 10 recently opened file paths (most recent first). */
  recentFiles: readonly string[];
  /** Last 5 recently opened folder paths (most recent first). */
  recentFolders: readonly string[];
  /** Record that a file was opened and update the list. */
  addRecentFile: (path: string) => void;
  /** Record that a folder was opened and update the list. */
  addRecentFolder: (path: string) => void;
  /** Remove a path from both lists (e.g. file deleted). */
  removeRecent: (path: string) => void;
  /** Clear all recent files. */
  clearFiles: () => void;
  /** Clear all recent folders. */
  clearFolders: () => void;
}

export function useRecentFiles(): UseRecentFilesReturn {
  const [recentFiles, setRecentFiles] = useState<readonly string[]>(getRecentFiles);
  const [recentFolders, setRecentFolders] = useState<readonly string[]>(getRecentFolders);

  const addRecentFile = useCallback((path: string) => {
    recordRecentFile(path);
    setRecentFiles(getRecentFiles());
  }, []);

  const addRecentFolder = useCallback((path: string) => {
    recordRecentFolder(path);
    setRecentFolders(getRecentFolders());
  }, []);

  const removeRecent = useCallback((path: string) => {
    removeRecentEntry(path);
    setRecentFiles(getRecentFiles());
    setRecentFolders(getRecentFolders());
  }, []);

  const clearFiles = useCallback(() => {
    clearRecentFiles();
    setRecentFiles(getRecentFiles());
  }, []);

  const clearFolders = useCallback(() => {
    clearRecentFolders();
    setRecentFolders(getRecentFolders());
  }, []);

  return {
    recentFiles,
    recentFolders,
    addRecentFile,
    addRecentFolder,
    removeRecent,
    clearFiles,
    clearFolders,
  };
}
