export const REVEAL_MODE = {
  LEXICAL: "lexical",
  PARAGRAPH: "paragraph",
  SOURCE: "source",
};

export const revealModes = [
  REVEAL_MODE.LEXICAL,
  REVEAL_MODE.PARAGRAPH,
  REVEAL_MODE.SOURCE,
];

export const REVEAL_MODE_LABELS = {
  [REVEAL_MODE.LEXICAL]: "Cursor reveal",
  [REVEAL_MODE.PARAGRAPH]: "Paragraph reveal",
  [REVEAL_MODE.SOURCE]: "Complete reveal",
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

const REVEAL_MODE_SET = new Set(revealModes);

export function normalizeRevealModeInput(mode) {
  const normalized = String(mode).toLowerCase();
  return REVEAL_MODE_SET.has(normalized) ? normalized : null;
}
