import type { EditorMode as Cm6EditorMode } from "../editor";
import {
  defaultEditorMode,
  type EditorMode,
  isLexicalEditorMode,
  normalizeEditorMode,
  normalizeEditorModeInput,
} from "../editor-display-mode";
import { REVEAL_MODE, type RevealMode } from "../lexical/reveal-mode";

export type AppSearchMode = "semantic" | "source";

export interface EditorModeAdapter {
  readonly appMode: EditorMode;
  readonly cm6Mode: Cm6EditorMode;
  readonly lexicalRevealMode: RevealMode;
  readonly searchMode: AppSearchMode;
  readonly usesLexicalSurface: boolean;
}

export function getEditorModeAdapter(
  mode: EditorMode | string | undefined,
  isMarkdown: boolean,
): EditorModeAdapter {
  const normalized = normalizeEditorMode(mode ?? defaultEditorMode, isMarkdown);
  return {
    appMode: normalized,
    cm6Mode: normalized === "source" ? "source" : "rich",
    lexicalRevealMode: normalized === "source" ? REVEAL_MODE.SOURCE : REVEAL_MODE.LEXICAL,
    searchMode: normalized === "source" ? "source" : "semantic",
    usesLexicalSurface: isLexicalEditorMode(normalized),
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
