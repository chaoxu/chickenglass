/**
 * Recent files and folders tracking.
 *
 * Stores the last MAX_FILES recently opened file paths and
 * the last MAX_FOLDERS recently opened folder paths in localStorage.
 */

import { readLocalStorage, writeLocalStorage } from "./lib/utils";
import { RECENT_FILES_KEY, RECENT_FOLDERS_KEY } from "../constants";

const MAX_FILES = 10;
const MAX_FOLDERS = 5;

export interface RecentFileEntry {
  path: string;
  projectRoot: string | null;
}

/** Read a string array from localStorage, filtering out non-strings. */
function readList(key: string): string[] {
  const parsed = readLocalStorage<unknown[]>(key, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === "string");
}

function isRecentFileEntry(value: unknown): value is RecentFileEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["path"] === "string"
    && (typeof candidate["projectRoot"] === "string" || candidate["projectRoot"] === null || candidate["projectRoot"] === undefined);
}

function readRecentFileEntries(): RecentFileEntry[] {
  const parsed = readLocalStorage<unknown[]>(RECENT_FILES_KEY, []);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): RecentFileEntry[] => {
    if (typeof entry === "string") {
      return [{ path: entry, projectRoot: null }];
    }
    if (isRecentFileEntry(entry)) {
      return [{ path: entry.path, projectRoot: entry.projectRoot ?? null }];
    }
    return [];
  });
}

function writeRecentFileEntries(entries: RecentFileEntry[]): void {
  writeLocalStorage(RECENT_FILES_KEY, entries);
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

function prependRecentFile(
  list: RecentFileEntry[],
  entry: RecentFileEntry,
): RecentFileEntry[] {
  const deduped = list.filter((candidate) =>
    !(candidate.path === entry.path && candidate.projectRoot === entry.projectRoot),
  );
  return [entry, ...deduped].slice(0, MAX_FILES);
}

/** Record that a file was opened. */
export function recordRecentFile(
  path: string,
  projectRoot: string | null = null,
): void {
  const list = readRecentFileEntries();
  writeRecentFileEntries(prependRecentFile(list, { path, projectRoot }));
}

/** Record that a folder was opened. */
export function recordRecentFolder(path: string): void {
  const list = readList(RECENT_FOLDERS_KEY);
  writeList(RECENT_FOLDERS_KEY, prepend(list, path, MAX_FOLDERS));
}

export function getRecentFileEntries(
  projectRoot?: string | null,
): readonly RecentFileEntry[] {
  const entries = readRecentFileEntries();
  if (projectRoot === undefined) return entries;
  return entries.filter((entry) => entry.projectRoot === projectRoot);
}

/** Return the most-recently-opened file paths (most recent first). */
export function getRecentFiles(
  projectRoot?: string | null,
): readonly string[] {
  return getRecentFileEntries(projectRoot).map((entry) => entry.path);
}

/** Return the most-recently-opened folder paths (most recent first). */
export function getRecentFolders(): readonly string[] {
  return readList(RECENT_FOLDERS_KEY);
}

export function removeRecentFile(
  path: string,
  projectRoot?: string | null,
): void {
  const nextEntries = readRecentFileEntries().filter((entry) =>
    !(entry.path === path && (projectRoot === undefined || entry.projectRoot === projectRoot)),
  );
  writeRecentFileEntries(nextEntries);
}

/** Remove a path from both lists (e.g. if a file is deleted or moved). */
export function removeRecentEntry(path: string): void {
  removeRecentFile(path);
  writeList(
    RECENT_FOLDERS_KEY,
    readList(RECENT_FOLDERS_KEY).filter((p) => p !== path),
  );
}

/** Clear all recent-file history. */
export function clearRecentFiles(): void {
  writeRecentFileEntries([]);
}

/** Clear all recent-folder history. */
export function clearRecentFolders(): void {
  writeList(RECENT_FOLDERS_KEY, []);
}
