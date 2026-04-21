export const REVEAL_MODE: {
  readonly LEXICAL: "lexical";
  readonly PARAGRAPH: "paragraph";
  readonly SOURCE: "source";
};

export type RevealMode = (typeof REVEAL_MODE)[keyof typeof REVEAL_MODE];

export const LEGACY_EDITOR_MODE_READ: "read";

export const revealModes: readonly [
  typeof REVEAL_MODE.LEXICAL,
  typeof REVEAL_MODE.PARAGRAPH,
  typeof REVEAL_MODE.SOURCE,
];

export const REVEAL_MODE_LABELS: Readonly<Record<RevealMode, string>>;

export const LEGACY_EDITOR_MODE_ALIASES: Readonly<Record<typeof LEGACY_EDITOR_MODE_READ, RevealMode>>;

export const REVEAL_PRESENTATION: {
  readonly INLINE: "inline";
  readonly FLOATING: "floating";
};

export type RevealPresentation =
  (typeof REVEAL_PRESENTATION)[keyof typeof REVEAL_PRESENTATION];

export const revealPresentations: readonly [
  typeof REVEAL_PRESENTATION.INLINE,
  typeof REVEAL_PRESENTATION.FLOATING,
];

export const REVEAL_PRESENTATION_LABELS: Readonly<Record<RevealPresentation, string>>;

export function normalizeRevealModeInput(mode: string): RevealMode | null;
