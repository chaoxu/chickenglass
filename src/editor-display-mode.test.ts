import { describe, expect, it } from "vitest";

import {
  defaultEditorMode,
  markdownEditorModes,
  normalizeEditorMode,
  normalizeEditorModeInput,
} from "./editor-display-mode";

describe("app editor display modes", () => {
  it("exposes all runtime editor surfaces", () => {
    expect(defaultEditorMode).toBe("cm6-rich");
    expect(markdownEditorModes).toEqual(["cm6-rich", "source"]);
  });

  it("normalizes legacy mode names to CM6 rich mode", () => {
    expect(normalizeEditorModeInput("lexical")).toBe("cm6-rich");
    expect(normalizeEditorModeInput("rich")).toBeNull();
    expect(normalizeEditorModeInput("read")).toBeNull();
  });

  it("forces non-markdown files into source mode", () => {
    expect(normalizeEditorMode("cm6-rich", false)).toBe("source");
    expect(normalizeEditorMode("lexical", false)).toBe("source");
  });
});
