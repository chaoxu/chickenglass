import { describe, expect, it } from "vitest";
import type { CslJsonItem } from "../../citations/bibtex-parser";
import { analyzeDocumentSemantics, stringTextSource } from "../../semantics/document";
import { CSS } from "../../constants/css-classes";
import { renderBibliography, resolveCrossrefLabel } from "./references";
import { mdParser } from "./shared";

describe("references module", () => {
  it("resolves equation and heading crossrefs from document semantics", () => {
    const doc = [
      "# Intro",
      "",
      "## Background {#sec:background}",
      "",
      "$$x^2$$ {#eq:energy}",
    ].join("\n");
    const tree = mdParser.parse(doc);
    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(resolveCrossrefLabel("sec:background", semantics)).toBe("Section 1.1");
    expect(resolveCrossrefLabel("eq:energy", semantics)).toBe("Eq. (1)");
  });

  it("renders bibliography entries with backlinks", () => {
    const doc = "A [@karger2000].";
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      issued: { "date-parts": [[2000]] },
    };
    const html = renderBibliography(
      new Map([[entry.id, entry]]),
      [entry.id],
      undefined,
      new Map([[entry.id, [{ occurrence: 1, from: 2, to: 15 }]]]),
      doc,
    );

    expect(html).toContain(`class="${CSS.bibliography}"`);
    expect(html).toContain(`class="${CSS.bibliographyEntry}"`);
    expect(html).toContain(`href="#cite-ref-1"`);
    expect(html).toContain(`title="Line 1: A [@karger2000]."`);
    expect(html).not.toContain("cited at");
    expect(html).not.toContain("↩1");
  });
});
