import { describe, expect, it } from "vitest";
import { findMatchingBrace } from "./char-utils";

// ---------------------------------------------------------------------------
// findMatchingBrace — basic behavior
// ---------------------------------------------------------------------------

describe("findMatchingBrace", () => {
  it("returns position after closing brace for simple block", () => {
    expect(findMatchingBrace("{abc}", 0)).toBe(5);
  });

  it("handles nested braces", () => {
    expect(findMatchingBrace("{a{b}c}", 0)).toBe(7);
  });

  it("returns -1 for unterminated brace", () => {
    expect(findMatchingBrace("{abc", 0)).toBe(-1);
  });

  it("returns -1 when pos is not an open brace", () => {
    expect(findMatchingBrace("abc}", 0)).toBe(-1);
  });

  it("returns -1 when pos is past end", () => {
    expect(findMatchingBrace("{}", 5)).toBe(-1);
  });

  it("handles offset start position", () => {
    expect(findMatchingBrace("xx{ab}yy", 2)).toBe(6);
  });

  it("handles empty braces", () => {
    expect(findMatchingBrace("{}", 0)).toBe(2);
  });

  it("handles deeply nested braces", () => {
    expect(findMatchingBrace("{a{b{c}d}e}", 0)).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: findMatchingBrace ignores quoted strings (#485)
//
// Before the fix, a closing brace inside a double-quoted string value would
// terminate the match prematurely. For example {.class key="val}ue"} would
// match at the } inside the quotes instead of the real closing brace.
// ---------------------------------------------------------------------------

describe("findMatchingBrace quote-awareness (#485 REGRESSION)", () => {
  it("skips closing brace inside double-quoted string", () => {
    const text = '{.class key="val}ue"}';
    expect(findMatchingBrace(text, 0)).toBe(text.length);
  });

  it("skips opening brace inside double-quoted string", () => {
    const text = '{key="val{ue"}';
    expect(findMatchingBrace(text, 0)).toBe(text.length);
  });

  it("handles multiple quoted values with braces inside", () => {
    const text = '{a="}" b="{"}';
    expect(findMatchingBrace(text, 0)).toBe(text.length);
  });

  it("handles quotes without braces inside (no change in behavior)", () => {
    const text = '{key="value"}';
    expect(findMatchingBrace(text, 0)).toBe(text.length);
  });

  it("returns -1 for unterminated quote with no closing brace after", () => {
    // Unterminated quote — no closing } is reachable
    expect(findMatchingBrace('{key="unterminated}', 0)).toBe(-1);
  });

  it("handles empty quoted string", () => {
    const text = '{key=""}';
    expect(findMatchingBrace(text, 0)).toBe(text.length);
  });

  it("handles adjacent quoted strings", () => {
    const text = '{a="x}y" b="p{q"}';
    expect(findMatchingBrace(text, 0)).toBe(text.length);
  });
});
