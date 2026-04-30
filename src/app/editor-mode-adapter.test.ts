import { describe, expect, it } from "vitest";
import {
  getEditorModeAdapter,
  normalizeAppEditorMode,
  normalizeAppEditorModeInput,
} from "./editor-mode-adapter";

describe("getEditorModeAdapter", () => {
  it("maps app modes to surface-specific modes", () => {
    expect(getEditorModeAdapter("cm6-rich", true)).toMatchObject({
      appMode: "cm6-rich",
      cm6Mode: "rich",
      searchMode: "semantic",
    });
    expect(getEditorModeAdapter("source", true)).toMatchObject({
      appMode: "source",
      cm6Mode: "source",
      searchMode: "source",
    });
  });

  it("centralizes aliases and non-markdown clamping", () => {
    expect(normalizeAppEditorModeInput("rich")).toBe("cm6-rich");
    expect(normalizeAppEditorModeInput("read")).toBe("cm6-rich");
    expect(normalizeAppEditorModeInput("lexical")).toBe("cm6-rich");
    expect(normalizeAppEditorMode("cm6-rich", false)).toBe("source");
    expect(getEditorModeAdapter("cm6-rich", false)).toMatchObject({
      appMode: "source",
      cm6Mode: "source",
      searchMode: "source",
    });
  });
});
