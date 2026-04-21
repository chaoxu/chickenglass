/**
 * Reveal modes model the "reveal scope" concept: every mode reveals a subtree
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
  REVEAL_MODE,
  revealModes,
} from "./reveal-mode-contract.js";
import type { RevealMode } from "./reveal-mode-contract.js";

export {
  LEGACY_EDITOR_MODE_ALIASES,
  LEGACY_EDITOR_MODE_READ,
  REVEAL_PRESENTATION,
  REVEAL_PRESENTATION_LABELS,
  REVEAL_MODE,
  REVEAL_MODE_LABELS,
  normalizeRevealModeInput,
  revealPresentations,
  revealModes,
} from "./reveal-mode-contract.js";
export type {
  RevealPresentation,
  RevealMode,
} from "./reveal-mode-contract.js";

const REVEAL_MODE_SET = new Set<string>(revealModes);

export function normalizeRevealMode(mode: RevealMode, isMarkdown: boolean): RevealMode {
  if (!isMarkdown) {
    return REVEAL_MODE.SOURCE;
  }
  if (REVEAL_MODE_SET.has(mode)) {
    return mode;
  }
  return REVEAL_MODE.LEXICAL;
}

/**
 * Does this editor mode leave the rendered rich surface mounted?
 * LEXICAL and PARAGRAPH share the same rich-surface + reveal plugin;
 * SOURCE mounts PlainTextPlugin instead.
 */
export function isRichRevealMode(mode: RevealMode): boolean {
  return mode === REVEAL_MODE.LEXICAL || mode === REVEAL_MODE.PARAGRAPH;
}
