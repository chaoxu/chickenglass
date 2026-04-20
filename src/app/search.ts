import { EDITOR_MODE, type EditorMode } from "./editor-mode";
import type { IndexQuery } from "../index/query-api";
import type { FileEntry } from "../lib/types";
import { collectMarkdownPathsFromTree } from "./project-file-enumerator";

export type AppSearchMode = "semantic" | "source";

export interface SearchNavigationTarget {
  file: string;
  pos: number;
  editorMode: EditorMode;
}

export function getAppSearchMode(editorMode: EditorMode): AppSearchMode {
  return editorMode === EDITOR_MODE.SOURCE ? "source" : "semantic";
}

/** Build a semantic index query from raw UI text and an optional type filter. */
export function buildSemanticSearchQuery(
  text: string,
  type: string | undefined,
): IndexQuery {
  const trimmed = text.trim();
  const isLabel = trimmed.startsWith("#") || /^[a-z]+-?\w*:\w/i.test(trimmed);
  if (isLabel) {
    const label = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    return { type, label };
  }
  return { type, content: trimmed || undefined };
}

/** Collect all markdown file paths reachable from a file tree. */
export function collectSearchableMarkdownPaths(entry: FileEntry): string[] {
  return collectMarkdownPathsFromTree(entry);
}
