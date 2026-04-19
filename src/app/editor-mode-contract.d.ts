export const EDITOR_MODE: {
  readonly LEXICAL: "lexical";
  readonly PARAGRAPH: "paragraph";
  readonly SOURCE: "source";
};

export type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];

export const LEGACY_EDITOR_MODE_READ: "read";

export const markdownEditorModes: readonly [
  typeof EDITOR_MODE.LEXICAL,
  typeof EDITOR_MODE.PARAGRAPH,
  typeof EDITOR_MODE.SOURCE,
];

export const EDITOR_MODE_LABELS: Readonly<Record<EditorMode, string>>;

export const LEGACY_EDITOR_MODE_ALIASES: Readonly<Record<typeof LEGACY_EDITOR_MODE_READ, EditorMode>>;

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

export function normalizeEditorModeInput(mode: string): EditorMode | null;

