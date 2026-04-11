import { describe, expect, it } from "vitest";

import type { CslJsonItem } from "../../citations/bibtex-parser";
import {
  formatCitationPreview,
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
});
