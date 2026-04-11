import { describe, expect, it } from "vitest";

import {
  buildFootnoteDefinitionMap,
  parseFootnoteDefinition,
  serializeFootnoteDefinition,
} from "./footnotes";

describe("footnotes", () => {
  it("parses multi-line footnote definitions", () => {
    expect(parseFootnoteDefinition([
      "[^proof]: First line",
      "  Second line",
    ].join("\n"))).toEqual({
      body: "First line\nSecond line",
      id: "proof",
    });
  });

  it("builds a document footnote map without duplicating later definitions", () => {
    const doc = [
      "[^proof]: First line",
      "  Second line",
      "",
      "[^proof]: Duplicate",
      "[^remark]: Aside",
    ].join("\n");

    expect(buildFootnoteDefinitionMap(doc)).toEqual(new Map([
      ["proof", "First line\nSecond line"],
      ["remark", "Aside"],
    ]));
  });

  it("serializes multi-line footnote bodies", () => {
    expect(serializeFootnoteDefinition("proof", "First line\nSecond line")).toBe([
      "[^proof]: First line",
      "  Second line",
    ].join("\n"));
  });
});
