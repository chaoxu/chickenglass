import { describe, expect, it } from "vitest";

import type { CslJsonItem } from "../../citations/bibtex-parser";
import {
  formatCitationPreview,
  NARRATIVE_REFERENCE_RE,
  parseReferenceToken,
  renderReferenceDisplay,
} from "./reference-display";
import type { RenderIndex } from "./reference-index";

const citeItem: CslJsonItem = {
  id: "knuth1984",
  title: "The TeXbook",
  type: "book",
};

const renderIndex: RenderIndex = {
  footnotes: new Map(),
  references: new Map([
    ["eq:sum", {
      kind: "equation",
      label: "Equation (1)",
      shortLabel: "(1)",
    }],
    ["fig:plot", {
      blockType: "figure",
      kind: "block",
      label: "Figure 2",
      shortLabel: "Figure 2",
    }],
  ]),
};

describe("reference-display", () => {
  it("parses clustered bracketed references and locators", () => {
    expect(parseReferenceToken("[@eq:sum, p. 3; @fig:plot]")).toEqual({
      bracketed: true,
      ids: ["eq:sum", "fig:plot"],
      locators: ["p. 3", undefined],
    });
  });

  it("renders local equations and block references with their display labels", () => {
    expect(renderReferenceDisplay("[@eq:sum]", renderIndex)).toBe("(1)");
    expect(renderReferenceDisplay("[@fig:plot]", renderIndex)).toBe("Figure 2");
  });

  it("formats citation previews from bibliography entries", () => {
    expect(formatCitationPreview("knuth1984", {
      store: new Map([["knuth1984", citeItem]]),
    })).toContain("The TeXbook");
  });

  describe("NARRATIVE_REFERENCE_RE does not capture trailing punctuation", () => {
    function matchIds(text: string): string[] {
      NARRATIVE_REFERENCE_RE.lastIndex = 0;
      const ids: string[] = [];
      for (const m of text.matchAll(NARRATIVE_REFERENCE_RE)) {
        ids.push(m[2]);
      }
      return ids;
    }

    it("excludes trailing period", () => {
      expect(matchIds("see @thm:fundamental.")).toEqual(["thm:fundamental"]);
    });

    it("excludes trailing comma", () => {
      expect(matchIds("@thm:main, which")).toEqual(["thm:main"]);
    });

    it("excludes trailing semicolon", () => {
      expect(matchIds("@sec:intro;")).toEqual(["sec:intro"]);
    });

    it("excludes trailing colon at end of sentence", () => {
      expect(matchIds("see @sec:results:")).toEqual(["sec:results"]);
    });

    it("keeps internal dots and colons", () => {
      expect(matchIds("@thm:main.sub")).toEqual(["thm:main.sub"]);
    });

    it("matches single-character references", () => {
      expect(matchIds("@x is")).toEqual(["x"]);
    });

    it("matches references at start of text", () => {
      expect(matchIds("@thm:main shows")).toEqual(["thm:main"]);
    });
  });
});
