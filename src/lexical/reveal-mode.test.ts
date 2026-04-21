import { describe, expect, it } from "vitest";

import {
  REVEAL_MODE,
  isRichRevealMode,
  normalizeRevealMode,
  normalizeRevealModeInput,
} from "./reveal-mode";

describe("Lexical reveal modes", () => {
  it("normalizes known reveal mode strings", () => {
    expect(normalizeRevealModeInput("lexical")).toBe(REVEAL_MODE.LEXICAL);
    expect(normalizeRevealModeInput("paragraph")).toBe(REVEAL_MODE.PARAGRAPH);
    expect(normalizeRevealModeInput("read")).toBeNull();
  });

  it("forces non-markdown files into source mode", () => {
    expect(normalizeRevealMode(REVEAL_MODE.LEXICAL, false)).toBe(REVEAL_MODE.SOURCE);
  });

  it("identifies modes that keep the rich surface mounted", () => {
    expect(isRichRevealMode(REVEAL_MODE.LEXICAL)).toBe(true);
    expect(isRichRevealMode(REVEAL_MODE.PARAGRAPH)).toBe(true);
    expect(isRichRevealMode(REVEAL_MODE.SOURCE)).toBe(false);
  });
});
