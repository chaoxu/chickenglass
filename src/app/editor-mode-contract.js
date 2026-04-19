export const EDITOR_MODE = {
  LEXICAL: "lexical",
  PARAGRAPH: "paragraph",
  SOURCE: "source",
};

export const LEGACY_EDITOR_MODE_READ = "read";

export const markdownEditorModes = [
  EDITOR_MODE.LEXICAL,
  EDITOR_MODE.PARAGRAPH,
  EDITOR_MODE.SOURCE,
];

export const EDITOR_MODE_LABELS = {
  [EDITOR_MODE.LEXICAL]: "Cursor reveal",
  [EDITOR_MODE.PARAGRAPH]: "Paragraph reveal",
  [EDITOR_MODE.SOURCE]: "Complete reveal",
};

export const LEGACY_EDITOR_MODE_ALIASES = {
  [LEGACY_EDITOR_MODE_READ]: EDITOR_MODE.LEXICAL,
};

export const REVEAL_PRESENTATION = {
  INLINE: "inline",
  FLOATING: "floating",
};

export const revealPresentations = [
  REVEAL_PRESENTATION.INLINE,
  REVEAL_PRESENTATION.FLOATING,
];

export const REVEAL_PRESENTATION_LABELS = {
  [REVEAL_PRESENTATION.INLINE]: "Inline",
  [REVEAL_PRESENTATION.FLOATING]: "Floating",
};

const MARKDOWN_EDITOR_MODE_SET = new Set(markdownEditorModes);

export function normalizeEditorModeInput(mode) {
  const normalized = String(mode).toLowerCase();
  return LEGACY_EDITOR_MODE_ALIASES[normalized] ?? (
    MARKDOWN_EDITOR_MODE_SET.has(normalized) ? normalized : null
  );
}

