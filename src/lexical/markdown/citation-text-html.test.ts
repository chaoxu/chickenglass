import { describe, expect, it } from "vitest";

import {
  renderCitationTextHtml,
  renderCitationTextInHtml,
} from "./citation-text-html";

describe("citation-text-html", () => {
  it("renders inline math without treating citation text as document markdown", () => {
    const html = renderCitationTextHtml("A $k$-hitting_set by @name and **literal** text.", {});

    expect(html).toContain("katex");
    expect(html).toContain("@name");
    expect(html).toContain("**literal**");
    expect(html).toContain("hitting_set");
  });

  it("renders inline math inside CSL HTML text nodes", () => {
    const html = renderCitationTextInHtml(
      '<div class="csl-entry"><div class="csl-left-margin">[1]</div><div class="csl-right-inline">A $k$-hitting set.</div></div>',
      {},
    );

    expect(html).toContain("csl-left-margin");
    expect(html).toContain("katex");
  });
});
