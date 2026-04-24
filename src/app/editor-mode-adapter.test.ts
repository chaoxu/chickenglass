import { describe, expect, it } from "vitest";
import { REVEAL_MODE } from "../lexical/reveal-mode";
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
      lexicalRevealMode: REVEAL_MODE.LEXICAL,
      searchMode: "semantic",
      usesLexicalSurface: false,
    });
    expect(getEditorModeAdapter("lexical", true)).toMatchObject({
      appMode: "lexical",
      cm6Mode: "rich",
      lexicalRevealMode: REVEAL_MODE.LEXICAL,
      searchMode: "semantic",
      usesLexicalSurface: true,
    });
    expect(getEditorModeAdapter("source", true)).toMatchObject({
      appMode: "source",
      cm6Mode: "source",
      lexicalRevealMode: REVEAL_MODE.SOURCE,
      searchMode: "source",
      usesLexicalSurface: false,
    });
  });

  it("centralizes aliases and non-markdown clamping", () => {
    expect(normalizeAppEditorModeInput("rich")).toBe("cm6-rich");
    expect(normalizeAppEditorModeInput("read")).toBe("cm6-rich");
    expect(normalizeAppEditorMode("lexical", false)).toBe("source");
    expect(getEditorModeAdapter("lexical", false)).toMatchObject({
      appMode: "source",
      cm6Mode: "source",
      lexicalRevealMode: REVEAL_MODE.SOURCE,
      searchMode: "source",
      usesLexicalSurface: false,
    });
  });
});
