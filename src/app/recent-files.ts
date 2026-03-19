/**
 * Recent files and folders tracking.
 *
 * Stores the last MAX_FILES recently opened file paths and
 * the last MAX_FOLDERS recently opened folder paths in localStorage.
 */

import { readLocalStorage, writeLocalStorage } from "./lib/utils";

const RECENT_FILES_KEY = "cg-recent-files";
const RECENT_FOLDERS_KEY = "cg-recent-folders";
const MAX_FILES = 10;
const MAX_FOLDERS = 5;

/** Read a string array from localStorage, filtering out non-strings. */
function readList(key: string): string[] {
  const parsed = readLocalStorage<unknown[]>(key, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === "string");
}

/** Persist a string array to localStorage. */
function writeList(key: string, list: string[]): void {
  writeLocalStorage(key, list);
}

/**
 * Prepend a path to the list, removing any existing duplicate, and cap
 * the list at `maxItems`. Returns the updated list.
 */
function prepend(list: string[], path: string, maxItems: number): string[] {
  const deduped = list.filter((p) => p !== path);
  return [path, ...deduped].slice(0, maxItems);
}

/** Record that a file was opened. */
export function recordRecentFile(path: string): void {
  const list = readList(RECENT_FILES_KEY);
  writeList(RECENT_FILES_KEY, prepend(list, path, MAX_FILES));
}

/** Record that a folder was opened. */
export function recordRecentFolder(path: string): void {
  const list = readList(RECENT_FOLDERS_KEY);
  writeList(RECENT_FOLDERS_KEY, prepend(list, path, MAX_FOLDERS));
}

/** Return the most-recently-opened file paths (most recent first). */
export function getRecentFiles(): readonly string[] {
  return readList(RECENT_FILES_KEY);
}

/** Return the most-recently-opened folder paths (most recent first). */
export function getRecentFolders(): readonly string[] {
  return readList(RECENT_FOLDERS_KEY);
}

/** Remove a path from both lists (e.g. if a file is deleted or moved). */
export function removeRecentEntry(path: string): void {
  writeList(
    RECENT_FILES_KEY,
    readList(RECENT_FILES_KEY).filter((p) => p !== path),
  );
  writeList(
    RECENT_FOLDERS_KEY,
    readList(RECENT_FOLDERS_KEY).filter((p) => p !== path),
  );
}

/** Clear all recent-file history. */
export function clearRecentFiles(): void {
  writeList(RECENT_FILES_KEY, []);
}

/** Clear all recent-folder history. */
export function clearRecentFolders(): void {
  writeList(RECENT_FOLDERS_KEY, []);
}
