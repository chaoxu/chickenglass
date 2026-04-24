import { describe, expect, it } from "vitest";

import {
  sourceSnippet,
  summarizeConsoleMessage,
} from "./browser-inspect.mjs";

describe("browser inspection helpers", () => {
  it("extracts a source snippet around the current selection", () => {
    expect(sourceSnippet("0123456789abcdef", {
      anchor: 8,
      focus: 10,
      from: 8,
      to: 10,
    }, 3)).toEqual({
      end: 13,
      from: 8,
      lineColumn: { col: 9, line: 1 },
      prefix: "567",
      selected: "89",
      start: 5,
      suffix: "abc",
      to: 10,
    });
  });

  it("clamps source snippets to document bounds", () => {
    expect(sourceSnippet("abc", {
      anchor: -2,
      focus: 20,
      from: -2,
      to: 20,
    }, 10)).toMatchObject({
      from: 0,
      lineColumn: { col: 1, line: 1 },
      selected: "abc",
      start: 0,
      to: 3,
    });
  });

  it("summarizes Playwright console messages", () => {
    expect(summarizeConsoleMessage({
      location: () => ({ url: "app.js", lineNumber: 1, columnNumber: 2 }),
      text: () => "boom",
      type: () => "error",
    })).toEqual({
      location: { url: "app.js", lineNumber: 1, columnNumber: 2 },
      text: "boom",
      type: "error",
    });
  });

  it("reports line and column for snippets", () => {
    expect(sourceSnippet("one\ntwo\nthree", {
      anchor: 8,
      focus: 8,
      from: 8,
      to: 8,
    }, 2)).toMatchObject({
      lineColumn: { col: 1, line: 3 },
    });
  });
});
