import { describe, expect, it } from "vitest";

import {
  defaultEditorMode,
  isCm6EditorMode,
  isLexicalEditorMode,
  markdownEditorModes,
  normalizeEditorMode,
  normalizeEditorModeInput,
} from "./editor-display-mode";

describe("app editor display modes", () => {
  it("exposes all runtime editor surfaces", () => {
    expect(defaultEditorMode).toBe("cm6-rich");
    expect(markdownEditorModes).toEqual(["cm6-rich", "lexical", "source"]);
  });

  it("normalizes legacy mode names to CM6 rich mode", () => {
    expect(normalizeEditorModeInput("rich")).toBe("cm6-rich");
    expect(normalizeEditorModeInput("read")).toBe("cm6-rich");
  });

  it("forces non-markdown files into source mode", () => {
    expect(normalizeEditorMode("cm6-rich", false)).toBe("source");
    expect(normalizeEditorMode("lexical", false)).toBe("source");
  });

  it("classifies runtime surfaces", () => {
    expect(isCm6EditorMode("cm6-rich")).toBe(true);
    expect(isCm6EditorMode("source")).toBe(true);
    expect(isCm6EditorMode("lexical")).toBe(false);
    expect(isLexicalEditorMode("lexical")).toBe(true);
  });
});
