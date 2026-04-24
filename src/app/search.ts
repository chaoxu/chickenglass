import type { EditorMode } from "../editor-display-mode";
import type { IndexQuery } from "../index/query-api";
import type { FileEntry } from "../lib/types";
import { getEditorModeAdapter } from "./editor-mode-adapter";
import type { AppSearchMode } from "./editor-mode-adapter";

export type { AppSearchMode };

export interface SearchNavigationTarget {
  file: string;
  pos: number;
  editorMode: EditorMode;
}

export function getAppSearchMode(editorMode: EditorMode): AppSearchMode {
  return getEditorModeAdapter(editorMode, true).searchMode;
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
  const results: string[] = [];

  const visit = (node: FileEntry) => {
    if (node.isDirectory) {
      for (const child of node.children ?? []) {
        visit(child);
      }
      return;
    }

    if (node.path.endsWith(".md")) {
      results.push(node.path);
    }
  };

  visit(entry);
  return results;
}
