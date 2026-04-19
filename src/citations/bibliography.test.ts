import { describe, expect, it } from "vitest";

import { buildBibliographyEntries } from "./bibliography";

describe("buildBibliographyEntries", () => {
  it("keeps markdown math source when CSL output has stripped delimiters", () => {
    const [entry] = buildBibliographyEntries(
      new Map([
        ["mathref", {
          id: "mathref",
          title: "A $k$-hitting set",
          type: "article",
        }],
      ]),
      ["mathref"],
      ['<div class="csl-entry">A k-hitting set.</div>'],
    );

    expect(entry.plainText).toContain("$k$");
    expect(entry.renderedHtml).toBeUndefined();
  });
});
