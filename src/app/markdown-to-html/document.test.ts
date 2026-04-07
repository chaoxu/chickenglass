import { describe, expect, it } from "vitest";
import type { CslJsonItem } from "../../citations/bibtex-parser";
import { CSS } from "../../constants/css-classes";
import { markdownToHtml } from "./document";

describe("document module", () => {
  it("appends the bibliography section after rendering the body", () => {
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      issued: { "date-parts": [[2000]] },
    };

    const html = markdownToHtml("See [@karger2000].", {
      bibliography: new Map([[entry.id, entry]]),
    });

    expect(html).toContain("<p>See ");
    expect(html).toContain(`class="${CSS.bibliography}"`);
    expect(html.indexOf(`class="${CSS.bibliography}"`)).toBeGreaterThan(html.indexOf("<p>See "));
  });
});
