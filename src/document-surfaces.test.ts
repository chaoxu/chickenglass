import { describe, expect, it } from "vitest";

import {
  renderDocumentFragmentToDom,
  renderDocumentFragmentToHtml,
} from "./document-surfaces";

describe("document surfaces", () => {
  it("uses chrome-safe degradation for chrome labels", () => {
    expect(
      renderDocumentFragmentToHtml({
        kind: "chrome-label",
        text: "[docs](https://example.com)",
      }),
    ).toBe("docs");
  });

  it("keeps document-inline richness for titles", () => {
    expect(
      renderDocumentFragmentToHtml({
        kind: "title",
        text: "[docs](https://example.com)",
      }),
    ).toContain('href="https://example.com"');
  });

  it("renders footnote fragments through the DOM surface helper", () => {
    const container = document.createElement("div");
    renderDocumentFragmentToDom(container, {
      kind: "footnote",
      text: "Footnote with $x^2$",
    });
    expect(container.textContent).toContain("Footnote with");
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
