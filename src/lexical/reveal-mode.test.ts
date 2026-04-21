import { describe, expect, it } from "vitest";

import {
  REVEAL_MODE,
  isRichRevealMode,
  normalizeRevealMode,
  normalizeRevealModeInput,
} from "./reveal-mode";

describe("Coflat 2 reveal modes", () => {
  it("normalizes legacy read mode to Lexical cursor reveal", () => {
    expect(normalizeRevealModeInput("read")).toBe(REVEAL_MODE.LEXICAL);
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
