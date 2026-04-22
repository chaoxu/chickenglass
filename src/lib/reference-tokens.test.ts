import { describe, expect, it } from "vitest";

import {
  parseReferenceToken,
  scanReferenceRevealTokens,
  scanReferenceTokens,
} from "./reference-tokens";

describe("reference-tokens", () => {
  it("accepts slash ids in narrative and bracketed references", () => {
    expect(parseReferenceToken("@sec:intro/motivation")).toEqual({
      bracketed: false,
      ids: ["sec:intro/motivation"],
      locators: [undefined],
    });
    expect(parseReferenceToken("[@sec:intro/motivation]")).toEqual({
      bracketed: true,
      ids: ["sec:intro/motivation"],
      locators: [undefined],
    });
  });

  it("accepts apostrophe ids in narrative and bracketed references", () => {
    expect(parseReferenceToken("@o'brien2020")).toEqual({
      bracketed: false,
      ids: ["o'brien2020"],
      locators: [undefined],
    });
    expect(parseReferenceToken("[@o'brien2020]")).toEqual({
      bracketed: true,
      ids: ["o'brien2020"],
      locators: [undefined],
    });
  });

  it("parses semicolon clusters", () => {
    expect(parseReferenceToken("[@thm:main; @eq:sum; @fig:plot]")).toEqual({
      bracketed: true,
      ids: ["thm:main", "eq:sum", "fig:plot"],
      locators: [undefined, undefined, undefined],
    });
  });

  it("excludes trailing punctuation from narrative ids", () => {
    expect(
      scanReferenceTokens("See @thm:main, @sec:results: and @fig:plot.").map(
        (token) => token.id,
      ),
    ).toEqual(["thm:main", "sec:results", "fig:plot"]);
  });

  it("rejects malformed bracket content", () => {
    expect(parseReferenceToken("[see @id]")).toBeNull();
    expect(parseReferenceToken("[@id; see @other]")).toBeNull();
    expect(scanReferenceTokens("[see @id]")).toEqual([]);
  });

  it("parses locator clusters", () => {
    expect(parseReferenceToken("[@doe2020, p. 12; @roe2021, ch. 3]")).toEqual({
      bracketed: true,
      ids: ["doe2020", "roe2021"],
      locators: ["p. 12", "ch. 3"],
    });
  });

  it("exposes one reveal token per rendered reference source", () => {
    expect(
      scanReferenceRevealTokens("See [@eq:sum; @fig:plot] and @sec:intro.").map((token) => ({
        bracketed: token.bracketed,
        source: token.source,
      })),
    ).toEqual([
      { bracketed: true, source: "[@eq:sum; @fig:plot]" },
      { bracketed: false, source: "@sec:intro" },
    ]);
  });
});
