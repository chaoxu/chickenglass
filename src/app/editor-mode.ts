/**
 * Editor modes model the "reveal scope" concept: every mode reveals a subtree
 * of the document AST as raw markdown. The difference is how big that subtree
 * is.
 *
 * - LEXICAL  (label: "Cursor reveal")    — reveal the inline run under the caret
 * - PARAGRAPH(label: "Paragraph reveal") — reveal the block under the caret
 * - SOURCE   (label: "Complete reveal")  — reveal the whole document
 *
 * String values are kept stable for settings migration. UI copy uses the
 * reveal vocabulary; internal code keeps the existing keys.
 */
import {
  EDITOR_MODE,
  markdownEditorModes,
} from "./editor-mode-contract.js";
import type { EditorMode } from "./editor-mode-contract.js";

export {
  EDITOR_MODE,
  EDITOR_MODE_LABELS,
  LEGACY_EDITOR_MODE_ALIASES,
  LEGACY_EDITOR_MODE_READ,
  markdownEditorModes,
  normalizeEditorModeInput,
  REVEAL_PRESENTATION,
  REVEAL_PRESENTATION_LABELS,
  revealPresentations,
} from "./editor-mode-contract.js";
export type {
  EditorMode,
  RevealPresentation,
} from "./editor-mode-contract.js";

const MARKDOWN_EDITOR_MODE_SET = new Set<string>(markdownEditorModes);

export function normalizeEditorMode(mode: EditorMode, isMarkdown: boolean): EditorMode {
  if (!isMarkdown) {
    return EDITOR_MODE.SOURCE;
  }
  if (MARKDOWN_EDITOR_MODE_SET.has(mode)) {
    return mode;
  }
  return EDITOR_MODE.LEXICAL;
}

/**
 * Does this editor mode leave the rendered rich surface mounted?
 * LEXICAL and PARAGRAPH share the same rich-surface + reveal plugin;
 * SOURCE mounts PlainTextPlugin instead.
 */
export function isRichEditorMode(mode: EditorMode): boolean {
  return mode === EDITOR_MODE.LEXICAL || mode === EDITOR_MODE.PARAGRAPH;
}
