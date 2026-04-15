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
export const EDITOR_MODE = {
  LEXICAL: "lexical",
  PARAGRAPH: "paragraph",
  SOURCE: "source",
} as const;

export type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];

export const LEGACY_EDITOR_MODE_READ = "read";

export const markdownEditorModes = [
  EDITOR_MODE.LEXICAL,
  EDITOR_MODE.PARAGRAPH,
  EDITOR_MODE.SOURCE,
] as const satisfies readonly EditorMode[];

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

/** Human-friendly UI labels keyed by mode. */
export const EDITOR_MODE_LABELS: Readonly<Record<EditorMode, string>> = {
  [EDITOR_MODE.LEXICAL]: "Cursor reveal",
  [EDITOR_MODE.PARAGRAPH]: "Paragraph reveal",
  [EDITOR_MODE.SOURCE]: "Complete reveal",
};

/** Short-form description shown beneath the mode picker. */
export const EDITOR_MODE_DESCRIPTIONS: Readonly<Record<EditorMode, string>> = {
  [EDITOR_MODE.LEXICAL]: "Reveal the inline run under the caret",
  [EDITOR_MODE.PARAGRAPH]: "Reveal the block under the caret",
  [EDITOR_MODE.SOURCE]: "Reveal the whole document",
};

export const REVEAL_PRESENTATION = {
  INLINE: "inline",
  FLOATING: "floating",
} as const;

export type RevealPresentation =
  (typeof REVEAL_PRESENTATION)[keyof typeof REVEAL_PRESENTATION];

export const revealPresentations = [
  REVEAL_PRESENTATION.INLINE,
  REVEAL_PRESENTATION.FLOATING,
] as const satisfies readonly RevealPresentation[];

export const REVEAL_PRESENTATION_LABELS: Readonly<Record<RevealPresentation, string>> = {
  [REVEAL_PRESENTATION.INLINE]: "Inline",
  [REVEAL_PRESENTATION.FLOATING]: "Floating",
};
