/** Shared app-level editor display modes. */
export type EditorMode = "cm6-rich" | "source";

/** Markdown modes exposed by the shared app shell. */
export const markdownEditorModes: readonly EditorMode[] = [
  "cm6-rich",
  "source",
];

export const defaultEditorMode: EditorMode = "cm6-rich";

const EDITOR_MODE_ALIASES: Readonly<Record<string, EditorMode>> = {
  lexical: "cm6-rich",
};

/**
 * Clamp a requested app display mode to modes supported by the active file.
 */
export function normalizeEditorMode(mode: EditorMode | string, isMarkdown: boolean): EditorMode {
  if (!isMarkdown) return "source";
  return normalizeEditorModeInput(mode) ?? defaultEditorMode;
}

export function normalizeEditorModeInput(mode: unknown): EditorMode | null {
  if (typeof mode !== "string") return null;
  if ((markdownEditorModes as readonly string[]).includes(mode)) {
    return mode as EditorMode;
  }
  return EDITOR_MODE_ALIASES[mode] ?? null;
}
