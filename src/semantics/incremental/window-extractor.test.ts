import { describe, expect, it } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../../parser";
import {
  analyzeEquations,
  analyzeFencedDivs,
  analyzeFootnotes,
  analyzeHeadings,
  analyzeMath,
  analyzeReferences,
  stringTextSource,
} from "../document";
import { extractStructuralWindow } from "./window-extractor";

const parser = baseParser.configure(markdownExtensions);

describe("extractStructuralWindow", () => {
  it("matches the full-document structural output used by current analyzers", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "See [@thm-main] and `@skip` and $@math$ and @eq:first.[^note]",
      "",
      "::: {.theorem #thm-main} Main Theorem",
      "Body.",
      ":::",
      "",
      "$$x^2$$ {#eq:first}",
      "",
      "## Details {-}",
      "",
      "[^note]: Footnote definition.",
    ].join("\n");
    const tree = parser.parse(doc);
    const src = stringTextSource(doc);

    const structural = extractStructuralWindow(src, tree, {
      from: 0,
      to: doc.length,
    });
    const headings = analyzeHeadings(src, tree);
    const footnotes = analyzeFootnotes(src, tree);
    const divs = analyzeFencedDivs(src, tree);
    const equations = analyzeEquations(src, tree);
    const mathRegions = analyzeMath(src, tree);
    const references = analyzeReferences(src, tree);

    expect(structural.headings).toEqual(
      headings.map(({ number: _number, ...heading }) => heading),
    );
    expect(structural.footnoteRefs).toEqual(footnotes.refs);
    expect(structural.footnoteDefs).toEqual(Array.from(footnotes.defs.values()));
    expect(structural.fencedDivs).toEqual(divs);
    expect(structural.equations).toEqual(
      equations.map(({ number: _number, ...equation }) => equation),
    );
    expect(structural.mathRegions).toEqual(mathRegions);
    expect(structural.bracketedRefs).toEqual(
      references.filter((reference) => reference.bracketed),
    );
  });

  it("returns overlapping structural nodes and exclusion ranges for a narrow window", () => {
    const doc = "See [@thm-main] and `@skip` and $@math$.\n";
    const tree = parser.parse(doc);
    const src = stringTextSource(doc);

    const linkFrom = doc.indexOf("[@thm-main]");
    const codeFrom = doc.indexOf("`@skip`");
    const mathFrom = doc.indexOf("$@math$");

    const structural = extractStructuralWindow(src, tree, {
      from: linkFrom + 2,
      to: mathFrom + 2,
    });

    expect(structural.bracketedRefs).toEqual([
      {
        from: linkFrom,
        to: linkFrom + "[@thm-main]".length,
        bracketed: true,
        ids: ["thm-main"],
        locators: [undefined],
      },
    ]);
    expect(structural.excludedRanges).toEqual([
      {
        from: linkFrom,
        to: linkFrom + "[@thm-main]".length,
      },
      {
        from: codeFrom,
        to: codeFrom + "`@skip`".length,
      },
      {
        from: mathFrom,
        to: mathFrom + "$@math$".length,
      },
    ]);
  });

  it("emits labeled equations when a window only touches the display-math body", () => {
    const doc = "$$x^2 + y^2$$ {#eq:pyth}\n";
    const tree = parser.parse(doc);
    const src = stringTextSource(doc);
    const equations = analyzeEquations(src, tree);

    const structural = extractStructuralWindow(src, tree, {
      from: doc.indexOf("x^2"),
      to: doc.indexOf("y^2") + 3,
    });

    expect(structural.mathRegions).toHaveLength(1);
    expect(structural.equations).toEqual(
      equations.map(({ number: _number, ...equation }) => equation),
    );
  });
});
