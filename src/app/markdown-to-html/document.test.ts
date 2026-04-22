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

  it("resolves cross-references inside task list items", () => {
    const html = markdownToHtml([
      "# Intro {#sec:intro}",
      "",
      "- [ ] See [@sec:intro].",
    ].join("\n"), {
      sectionNumbers: true,
    });

    expect(html).toContain("<li><input");
    expect(html).toContain('href="#sec:intro"');
    expect(html).toContain("Section 1");
  });

  it("resolves cross-references inside footnote definitions", () => {
    const html = markdownToHtml([
      "# Intro {#sec:intro}",
      "",
      "See note.[^n]",
      "",
      "[^n]: See [@sec:intro].",
    ].join("\n"), {
      sectionNumbers: true,
    });

    expect(html).toContain('id="fn-n"');
    expect(html).toContain('href="#sec:intro"');
    expect(html).toContain("Section 1");
  });

  it("applies image URL overrides inside task list items", () => {
    const html = markdownToHtml("- [ ] ![Plot](images/plot.png)", {
      documentPath: "notes/main.md",
      imageUrlOverrides: new Map([
        ["notes/images/plot.png", "https://cdn.example.test/plot.png"],
      ]),
    });

    expect(html).toContain('<img src="https://cdn.example.test/plot.png" alt="Plot">');
  });

  it("applies image URL overrides inside footnote definitions", () => {
    const html = markdownToHtml("See note.[^plot]\n\n[^plot]: ![Plot](images/plot.png)", {
      documentPath: "notes/main.md",
      imageUrlOverrides: new Map([
        ["notes/images/plot.png", "https://cdn.example.test/plot.png"],
      ]),
    });

    expect(html).toContain('<img src="https://cdn.example.test/plot.png" alt="Plot">');
  });
});
