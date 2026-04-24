/**
 * useRecentFiles — React hook for tracking recently opened files and folders.
 *
 * Wraps the vanilla recent-files.ts module with a reactive React interface.
 * Exposes the current lists and mutating helpers that update both localStorage
 * and the in-memory state together.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getRecentSnapshot,
  recordRecentFile,
  recordRecentFolder,
  removeRecentFile,
  removeRecentEntry,
  clearRecentFiles,
  clearRecentFolders,
  subscribeRecentState,
  type RecentFileEntry,
} from "../recent-files";

export interface UseRecentFilesReturn {
  /** Last 10 recently opened file paths (most recent first). */
  recentFiles: readonly string[];
  /** Rich recent-file entries scoped to the current project. */
  recentFileEntries: readonly RecentFileEntry[];
  /** Last 5 recently opened folder paths (most recent first). */
  recentFolders: readonly string[];
  /** Record that a file was opened and update the list. */
  addRecentFile: (path: string) => void;
  /** Record that a folder was opened and update the list. */
  addRecentFolder: (path: string) => void;
  /** Remove a file entry for the current project. */
  removeRecentFile: (path: string) => void;
  /** Remove a path from both lists (e.g. file deleted). */
  removeRecent: (path: string) => void;
  /** Clear all recent files. */
  clearFiles: () => void;
  /** Clear all recent folders. */
  clearFolders: () => void;
}

export function useRecentFiles(
  currentProjectRoot: string | null,
): UseRecentFilesReturn {
  const recentState = useSyncExternalStore(
    subscribeRecentState,
    getRecentSnapshot,
    getRecentSnapshot,
  );

  const recentFileEntries = useMemo(
    () => recentState.fileEntries.filter((entry) => entry.projectRoot === currentProjectRoot),
    [recentState.fileEntries, currentProjectRoot],
  );

  const recentFiles = useMemo(
    () => recentFileEntries.map((entry) => entry.path),
    [recentFileEntries],
  );

  const addRecentFile = useCallback((path: string) => {
    recordRecentFile(path, currentProjectRoot);
  }, [currentProjectRoot]);

  const addRecentFolder = useCallback((path: string) => {
    recordRecentFolder(path);
  }, []);

  const removeRecentFileForCurrentProject = useCallback((path: string) => {
    removeRecentFile(path, currentProjectRoot);
  }, [currentProjectRoot]);

  const removeRecent = useCallback((path: string) => {
    removeRecentEntry(path);
  }, []);

  const clearFiles = useCallback(() => {
    clearRecentFiles();
  }, []);

  const clearFolders = useCallback(() => {
    clearRecentFolders();
  }, []);

  return {
    recentFiles,
    recentFileEntries,
    recentFolders: recentState.folders,
    addRecentFile,
    addRecentFolder,
    removeRecentFile: removeRecentFileForCurrentProject,
    removeRecent,
    clearFiles,
    clearFolders,
  };
}
