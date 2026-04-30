import type { EditorMode as Cm6EditorMode } from "../editor";
import {
  defaultEditorMode,
  type EditorMode,
  normalizeEditorMode,
  normalizeEditorModeInput,
} from "../editor-display-mode";

export type AppSearchMode = "semantic" | "source";

export interface EditorModeAdapter {
  readonly appMode: EditorMode;
  readonly cm6Mode: Cm6EditorMode;
  readonly searchMode: AppSearchMode;
}

export function getEditorModeAdapter(
  mode: EditorMode | string | undefined,
  isMarkdown: boolean,
): EditorModeAdapter {
  const normalized = normalizeEditorMode(mode ?? defaultEditorMode, isMarkdown);
  return {
    appMode: normalized,
    cm6Mode: normalized === "source" ? "source" : "rich",
    searchMode: normalized === "source" ? "source" : "semantic",
  };
}

export function normalizeAppEditorMode(
  mode: EditorMode | string,
  isMarkdown: boolean,
): EditorMode {
  return normalizeEditorMode(mode, isMarkdown);
}

export function normalizeAppEditorModeInput(mode: unknown): EditorMode | null {
  return normalizeEditorModeInput(mode);
}
