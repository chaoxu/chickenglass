export type EditorMode = "lexical" | "source";

export const markdownEditorModes = ["lexical", "source"] as const satisfies readonly EditorMode[];

export function normalizeEditorMode(mode: EditorMode, isMarkdown: boolean): EditorMode {
  if (!isMarkdown) {
    return "source";
  }
  if (mode === "source") {
    return mode;
  }
  return "lexical";
}
