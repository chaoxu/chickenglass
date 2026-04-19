import { describe, expect, it } from "vitest";

import {
  isReferenceTokenSource,
  parseReferenceToken,
  scanReferenceTokens,
} from "./reference-tokens";

describe("reference token scanner", () => {
  it("scans bracketed clusters with locators", () => {
    expect(scanReferenceTokens("See [@a, p. 4; @b] and @c.")).toMatchObject([
      {
        bracketed: true,
        clusterFrom: 4,
        clusterIndex: 0,
        id: "a",
        locator: "p. 4",
      },
      {
        bracketed: true,
        clusterFrom: 4,
        clusterIndex: 1,
        id: "b",
        locator: undefined,
      },
      {
        bracketed: false,
        id: "c",
      },
    ]);
  });

  it("ignores emails, mailto URLs, and embedded @ tokens", () => {
    expect(scanReferenceTokens([
      "user@example.com",
      "mailto:user@example.com",
      "word@embedded",
      "@thm-main",
    ].join(" ")).map((token) => token.id)).toEqual(["thm-main"]);
  });

  it("parses complete token sources for display and reveal", () => {
    expect(parseReferenceToken("[@eq:sum, p. 3; @fig:plot]")).toEqual({
      bracketed: true,
      ids: ["eq:sum", "fig:plot"],
      locators: ["p. 3", undefined],
    });
    expect(parseReferenceToken("@thm-main")).toEqual({
      bracketed: false,
      ids: ["thm-main"],
      locators: [undefined],
    });
  });

  it("rejects incomplete or embedded reveal sources", () => {
    expect(isReferenceTokenSource("[@thm-main")).toBe(false);
    expect(isReferenceTokenSource("word@embedded")).toBe(false);
    expect(isReferenceTokenSource("user@example.com")).toBe(false);
  });
});
