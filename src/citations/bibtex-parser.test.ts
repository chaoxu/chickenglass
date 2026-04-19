import { describe, expect, it } from "vitest";

import { parseBibTeX } from "./bibtex-parser";

describe("parseBibTeX", () => {
  it("preserves markdown math delimiters in titles", () => {
    const [entry] = parseBibTeX([
      "@article{mathref,",
      "  title = {A $k$-hitting set},",
      "  year = {2020},",
      "}",
    ].join("\n"));

    expect(entry.title).toBe("A $k$-hitting set");
  });

  it("preserves markdown math delimiters in parenthesized entries", () => {
    const [entry] = parseBibTeX([
      "@article(mathref,",
      "  title = {A $k$-hitting set},",
      "  year = {2020},",
      ")",
    ].join("\n"));

    expect(entry.title).toBe("A $k$-hitting set");
  });
});
