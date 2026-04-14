export const EDITOR_MODE = {
  LEXICAL: "lexical",
  SOURCE: "source",
} as const;

export type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];

export const LEGACY_EDITOR_MODE_READ = "read";

export const markdownEditorModes = [
  EDITOR_MODE.LEXICAL,
  EDITOR_MODE.SOURCE,
] as const satisfies readonly EditorMode[];

export function normalizeEditorMode(mode: EditorMode, isMarkdown: boolean): EditorMode {
  if (!isMarkdown) {
    return EDITOR_MODE.SOURCE;
  }
  if (mode === EDITOR_MODE.SOURCE) {
    return mode;
  }
  return EDITOR_MODE.LEXICAL;
}
