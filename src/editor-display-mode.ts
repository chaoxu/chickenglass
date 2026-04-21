/** Shared app-level editor display modes. */
export type EditorMode = "rich" | "source" | "read";

/** Markdown modes exposed by the shared app shell. */
export const markdownEditorModes: readonly EditorMode[] = ["rich", "source"];

/**
 * Clamp a requested app display mode to modes supported by the active file.
 *
 * Read mode is reserved for the deferred HTML reader. Until it is exposed in
 * the status bar cycle, markdown files fall back to rich mode when a caller
 * requests `"read"`; non-markdown files are always source-only.
 */
export function normalizeEditorMode(mode: EditorMode, isMarkdown: boolean): EditorMode {
  if (!isMarkdown) return "source";
  return mode === "read" ? "rich" : mode;
}
