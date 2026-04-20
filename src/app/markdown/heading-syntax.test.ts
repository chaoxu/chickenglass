import { describe, expect, it } from "vitest";

import {
  findTrailingHeadingAttributes,
  parseHeadingLine,
  parseHeadingText,
} from "./heading-syntax";
import { extractHeadingDefinitions } from "./headings";

describe("heading syntax", () => {
  it("parses heading text, labels, unnumbered markers, and source columns", () => {
    expect(parseHeadingLine("### Mixed attributes {.unnumbered #sec:mixed -}")).toMatchObject({
      attrs: "{.unnumbered #sec:mixed -}",
      id: "sec:mixed",
      labelFrom: 35,
      labelTo: 44,
      level: 3,
      text: "Mixed attributes",
      unnumbered: true,
    });
  });

  it("handles headings without attributes", () => {
    expect(parseHeadingLine("## Plain heading")).toMatchObject({
      attrs: undefined,
      id: undefined,
      level: 2,
      text: "Plain heading",
      unnumbered: false,
    });
  });

  it("shares trailing-attribute parsing between markdown and Lexical callers", () => {
    const rawText = "Appendix {-}";
    expect(findTrailingHeadingAttributes(rawText)).toBe("{-}");
    expect(parseHeadingText(rawText)).toMatchObject({
      text: "Appendix",
      unnumbered: true,
    });
  });

  it("keeps outline extraction aligned with the shared parser", () => {
    const headings = extractHeadingDefinitions([
      "# Intro {#sec:intro}",
      "## Aside {.unnumbered}",
      "## Next {#sec:next}",
    ].join("\n"));

    expect(headings).toMatchObject([
      { id: "sec:intro", level: 1, number: "1", text: "Intro" },
      { level: 2, number: "", text: "Aside" },
      { id: "sec:next", level: 2, number: "1.1", text: "Next" },
    ]);
  });
});
