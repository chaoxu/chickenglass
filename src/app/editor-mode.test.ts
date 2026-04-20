import { describe, expect, it } from "vitest";

import {
  EDITOR_MODE,
  isRichEditorMode,
  normalizeEditorMode,
  normalizeEditorModeInput,
} from "./editor-mode";

describe("Coflat 2 app editor modes", () => {
  it("normalizes legacy read mode to Lexical cursor reveal", () => {
    expect(normalizeEditorModeInput("read")).toBe(EDITOR_MODE.LEXICAL);
  });

  it("forces non-markdown files into source mode", () => {
    expect(normalizeEditorMode(EDITOR_MODE.LEXICAL, false)).toBe(EDITOR_MODE.SOURCE);
  });

  it("identifies modes that keep the rich surface mounted", () => {
    expect(isRichEditorMode(EDITOR_MODE.LEXICAL)).toBe(true);
    expect(isRichEditorMode(EDITOR_MODE.PARAGRAPH)).toBe(true);
    expect(isRichEditorMode(EDITOR_MODE.SOURCE)).toBe(false);
  });
});
