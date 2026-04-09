import { describe, expect, it } from "vitest";
import { analyzeMarkdownSemantics } from "../semantics/markdown-analysis";

describe("classifyReferenceIndex", () => {
  it("indexes citations, headings, blocks, and equation labels from one analysis", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "::: {.theorem #thm:main}",
      "Body.",
      ":::",
      "",
      "See [@knuth1990], [@sec:intro], and [@eq:main].",
      "",
      "$$x^2$$ {#eq:main}",
    ].join("\n");

    const analysis = analyzeMarkdownSemantics(doc);

    expect(analysis.referenceIndex.get("knuth1990")).toMatchObject({
      id: "knuth1990",
      type: "citation",
      display: "knuth1990",
      target: null,
    });
    expect(analysis.referenceIndex.get("sec:intro")).toMatchObject({
      id: "sec:intro",
      type: "crossref",
      targetKind: "heading",
      display: "Section 1",
    });
    expect(analysis.referenceIndex.get("thm:main")).toMatchObject({
      id: "thm:main",
      type: "crossref",
      targetKind: "block",
      display: "theorem",
    });
    expect(analysis.referenceIndex.get("eq:main")).toMatchObject({
      id: "eq:main",
      type: "label",
      targetKind: "equation",
      display: "Eq. (1)",
      ordinal: 1,
    });
  });

  it("keeps citation ids in first-appearance order and prefers local targets on collisions", () => {
    const doc = [
      "See [@beta] then [@alpha].",
      "",
      "# Section {#dup}",
      "",
      "$$x$$ {#dup}",
      "",
      "::: {.theorem #dup}",
      "Body.",
      ":::",
    ].join("\n");

    const analysis = analyzeMarkdownSemantics(doc);
    const citationIds = [...analysis.referenceIndex.values()]
      .filter((entry) => entry.type === "citation")
      .map((entry) => entry.id);

    expect(citationIds).toEqual(["beta", "alpha"]);
    expect(analysis.referenceIndex.get("dup")).toMatchObject({
      type: "crossref",
      targetKind: "block",
    });
  });
});
