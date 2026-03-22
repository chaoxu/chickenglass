import { describe, expect, it } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../parser";
import {
  analyzeDocumentSemantics,
  analyzeFencedDivs,
  analyzeFootnotes,
  analyzeHeadings,
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
        number: "1",
        unnumbered: false,
      },
      {
        from: 20,
        to: 34,
        level: 2,
        text: "Details",
        number: "",
        unnumbered: true,
      },
    ]);
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
});
