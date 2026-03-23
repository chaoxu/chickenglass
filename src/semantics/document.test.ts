import { describe, expect, it } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../parser";
import {
  analyzeDocumentSemantics,
  analyzeEquations,
  analyzeFencedDivs,
  analyzeFootnotes,
  analyzeHeadings,
  analyzeReferences,
  findTrailingHeadingAttributes,
  stringTextSource,
} from "./document";

const parser = baseParser.configure(markdownExtensions);

describe("document semantics analyzers", () => {
  it("analyzes headings with shared numbering and attribute stripping", () => {
    const doc = "# Intro {.foo-bar}\n\n## Details {-}\n";
    const tree = parser.parse(doc);

    const headings = analyzeHeadings(stringTextSource(doc), tree);

    expect(headings).toEqual([
      {
        from: 0,
        to: 18,
        level: 1,
        text: "Intro",
        id: undefined,
        number: "1",
        unnumbered: false,
      },
      {
        from: 20,
        to: 34,
        level: 2,
        text: "Details",
        id: undefined,
        number: "",
        unnumbered: true,
      },
    ]);
  });

  it("extracts heading ids into the shared heading slice", () => {
    const doc = "# Intro {#sec:intro}\n";
    const tree = parser.parse(doc);

    const headings = analyzeHeadings(stringTextSource(doc), tree);

    expect(headings[0]?.id).toBe("sec:intro");
  });

  it("analyzes footnote refs and definitions once", () => {
    const doc = "Alpha[^note]\n\n[^note]: hello world\n";
    const tree = parser.parse(doc);

    const footnotes = analyzeFootnotes(stringTextSource(doc), tree);

    expect(footnotes.refs).toEqual([{ id: "note", from: 5, to: 12 }]);
    expect(footnotes.defs.get("note")).toMatchObject({
      id: "note",
      content: "hello world",
    });
    expect(footnotes.refByFrom.get(5)?.id).toBe("note");
  });

  it("analyzes fenced div metadata with title fallback from attributes", () => {
    const doc = '::: {.problem #p1 title="**3SUM**"}\nBody\n:::\n';
    const tree = parser.parse(doc);

    const divs = analyzeFencedDivs(stringTextSource(doc), tree);

    expect(divs).toHaveLength(1);
    expect(divs[0]).toMatchObject({
      primaryClass: "problem",
      classes: ["problem"],
      id: "p1",
      title: "**3SUM**",
      isSelfClosing: false,
    });
  });

  it("builds position maps for shared rich/read lookup", () => {
    const doc = "# Intro\n\nText[^n]\n\n[^n]: note\n";
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.headingByFrom.get(0)?.text).toBe("Intro");
    expect(semantics.footnotes.refByFrom.get(13)?.id).toBe("n");
  });

  it("analyzes equations once for shared numbering and lookup", () => {
    const doc = "$$x^2$$ {#eq:first}\n\n$$y^2$$ {#eq:second}\n";
    const tree = parser.parse(doc);

    const equations = analyzeEquations(stringTextSource(doc), tree);

    expect(equations).toHaveLength(2);
    expect(equations[0]).toMatchObject({ id: "eq:first", number: 1 });
    expect(equations[1]).toMatchObject({ id: "eq:second", number: 2 });
  });

  it("analyzes bracketed and narrative references once", () => {
    const doc = "See [@thm-main] and @eq:first.\n";
    const tree = parser.parse(doc);

    const refs = analyzeReferences(stringTextSource(doc), tree);

    expect(refs).toEqual([
      {
        from: 4,
        to: 15,
        bracketed: true,
        ids: ["thm-main"],
        locators: [undefined],
      },
      {
        from: 20,
        to: 29,
        bracketed: false,
        ids: ["eq:first"],
        locators: [undefined],
      },
    ]);
  });

  it("includes equations and references in canonical document analysis", () => {
    const doc = "$$x^2$$ {#eq:first}\n\nSee [@eq:first]\n";
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.equationById.get("eq:first")?.number).toBe(1);
    expect(semantics.references[0]?.ids).toEqual(["eq:first"]);
  });

  it("extracts includes from multi-line include blocks", () => {
    const doc = "::: {.include}\nchapter1.md\n:::\n";
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.includes).toHaveLength(1);
    expect(semantics.includes[0]).toMatchObject({
      path: "chapter1.md",
    });
    expect(semantics.includes[0].from).toBe(0);
    expect(semantics.includeByFrom.get(0)?.path).toBe("chapter1.md");
  });

  it("extracts includes from single-line include blocks", () => {
    const doc = "::: {.include} chapter1.md :::\n";
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.includes).toHaveLength(1);
    expect(semantics.includes[0]).toMatchObject({
      path: "chapter1.md",
    });
  });

  it("extracts multiple includes", () => {
    const doc = [
      "::: {.include}",
      "chapter1.md",
      ":::",
      "",
      "Some text.",
      "",
      "::: {.include}",
      "chapter2.md",
      ":::",
    ].join("\n");
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.includes).toHaveLength(2);
    expect(semantics.includes[0].path).toBe("chapter1.md");
    expect(semantics.includes[1].path).toBe("chapter2.md");
  });

  it("does not extract includes from non-include fenced divs", () => {
    const doc = "::: {.theorem} Main Theorem\nBody.\n:::\n";
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.includes).toHaveLength(0);
    expect(semantics.fencedDivs).toHaveLength(1);
  });

  it("extracts includes with directory paths", () => {
    const doc = "::: {.include}\nchapters/intro.md\n:::\n";
    const tree = parser.parse(doc);

    const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);

    expect(semantics.includes).toHaveLength(1);
    expect(semantics.includes[0].path).toBe("chapters/intro.md");
  });

  // --- Regression: #353 — literal braces must not be treated as Pandoc attributes ---
  it("preserves literal brace text that is not Pandoc attribute syntax", () => {
    // `{1,2,3}` is a set literal, not a Pandoc attribute block
    const doc = "# Set {1,2,3}\n";
    const tree = parser.parse(doc);

    const headings = analyzeHeadings(stringTextSource(doc), tree);

    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Set {1,2,3}");
    expect(headings[0].id).toBeUndefined();
  });

  it("findTrailingHeadingAttributes returns null for non-attribute braces", () => {
    // Various content that looks like braces but is NOT Pandoc attributes
    expect(findTrailingHeadingAttributes("Set {1,2,3}")).toBeNull();
    expect(findTrailingHeadingAttributes("Set {a, b}")).toBeNull();
    expect(findTrailingHeadingAttributes("Set {}")).toBeNull();
    expect(findTrailingHeadingAttributes("Map {key: value}")).toBeNull();
  });

  it("findTrailingHeadingAttributes still strips valid Pandoc attributes", () => {
    expect(findTrailingHeadingAttributes("Intro {#sec:intro}")).toMatchObject({
      content: "#sec:intro",
    });
    expect(findTrailingHeadingAttributes("Details {-}")).toMatchObject({
      content: "-",
    });
    expect(findTrailingHeadingAttributes("Title {.unnumbered}")).toMatchObject({
      content: ".unnumbered",
    });
    expect(findTrailingHeadingAttributes("Title {#id .class}")).toMatchObject({
      content: "#id .class",
    });
    expect(findTrailingHeadingAttributes('Title {key="value"}')).not.toBeNull();
  });

  // --- Regression: #354 — skipped heading levels produce "1.0.1" instead of "1.1" ---
  it("skips zero-valued intermediate counters for non-sequential heading levels", () => {
    // `# A` (level 1) then `### C` (level 3) should produce "1.1", not "1.0.1"
    const doc = "# A\n\n### C\n";
    const tree = parser.parse(doc);

    const headings = analyzeHeadings(stringTextSource(doc), tree);

    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatchObject({ level: 1, text: "A", number: "1" });
    expect(headings[1]).toMatchObject({ level: 3, text: "C", number: "1.1" });
  });

  it("handles multiple skipped levels correctly", () => {
    // `# A` then `#### D` should produce "1.1"
    const doc = "# A\n\n#### D\n";
    const tree = parser.parse(doc);

    const headings = analyzeHeadings(stringTextSource(doc), tree);

    expect(headings[1]).toMatchObject({ level: 4, text: "D", number: "1.1" });
  });

  it("sequential heading levels still produce full numbering", () => {
    // Normal case: `# A` → `## B` → `### C` should still produce "1.1.1"
    const doc = "# A\n\n## B\n\n### C\n";
    const tree = parser.parse(doc);

    const headings = analyzeHeadings(stringTextSource(doc), tree);

    expect(headings[0]).toMatchObject({ number: "1" });
    expect(headings[1]).toMatchObject({ number: "1.1" });
    expect(headings[2]).toMatchObject({ number: "1.1.1" });
  });

  it("unified walk matches individual analyzers on a mixed document", () => {
    const doc = [
      "# Introduction {#sec:intro}",
      "",
      "Some text[^fn1] with a reference [@thm-main].",
      "",
      "::: {.theorem #thm-main} Main Theorem",
      "Statement here.",
      ":::",
      "",
      "$$x^2 + y^2$$ {#eq:pyth}",
      "",
      "$$z^3$$ {#eq:cube}",
      "",
      "## Details {-}",
      "",
      "See @eq:pyth for details.",
      "",
      "[^fn1]: A footnote definition.",
      "",
    ].join("\n");
    const tree = parser.parse(doc);
    const src = stringTextSource(doc);

    // Individual analyzers (each does its own tree walk)
    const indivHeadings = analyzeHeadings(src, tree);
    const indivFootnotes = analyzeFootnotes(src, tree);
    const indivDivs = analyzeFencedDivs(src, tree);
    const indivEquations = analyzeEquations(src, tree);
    const indivRefs = analyzeReferences(src, tree);

    // Unified walk via analyzeDocumentSemantics
    const unified = analyzeDocumentSemantics(src, tree);

    expect(unified.headings).toEqual(indivHeadings);
    expect(unified.footnotes.refs).toEqual(indivFootnotes.refs);
    expect(unified.footnotes.defs).toEqual(indivFootnotes.defs);
    expect(unified.fencedDivs).toEqual(indivDivs);
    expect(unified.equations).toEqual(indivEquations);
    expect(unified.references).toEqual(indivRefs);

    // Verify lookup maps are consistent
    expect(unified.headingByFrom.size).toBe(indivHeadings.length);
    expect(unified.fencedDivByFrom.size).toBe(indivDivs.length);
    expect(unified.equationById.size).toBe(indivEquations.length);
    expect(unified.referenceByFrom.size).toBe(indivRefs.length);
  });
});
