import { describe, expect, it } from "vitest";
import { type CslJsonItem } from "./bibtex-parser";
import {
  CslProcessor,
  parseLocator,
  registerCitationsWithProcessor,
} from "./csl-processor";

describe("parseLocator", () => {
  it("parses chapter abbreviation", () => {
    expect(parseLocator("chap. 36")).toEqual({ label: "chapter", locator: "36" });
  });

  it("parses page abbreviation (plural)", () => {
    expect(parseLocator("pp. 100-120")).toEqual({ label: "page", locator: "100-120" });
  });

  it("parses page abbreviation (singular)", () => {
    expect(parseLocator("p. 42")).toEqual({ label: "page", locator: "42" });
  });

  it("parses full word labels", () => {
    expect(parseLocator("section 3.2")).toEqual({ label: "section", locator: "3.2" });
  });

  it("parses volume abbreviation", () => {
    expect(parseLocator("vol. 2")).toEqual({ label: "volume", locator: "2" });
  });

  it("returns no label for unrecognized prefix", () => {
    expect(parseLocator("theorem 3")).toEqual({ locator: "theorem 3" });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseLocator("  chap. 5  ")).toEqual({ label: "chapter", locator: "5" });
  });

  it("returns raw text when label has no remaining value", () => {
    // "chap." with nothing after it — no locator value
    expect(parseLocator("chap.")).toEqual({ locator: "chap." });
  });
});

describe("CslProcessor narrative citations", () => {
  const entry: CslJsonItem = {
    id: "karger2000",
    type: "article-journal",
    author: [{ family: "Karger", given: "David R." }],
    title: "Minimum cuts in near-linear time",
    issued: { "date-parts": [[2000]] },
    "container-title": "JACM",
  };

  it("uses composite citeproc output when the style provides one", () => {
    const processor = new CslProcessor([entry]);
    (processor as unknown as {
      engine: {
        processCitationCluster: () => [null, [[number, string, string]]];
        makeCitationCluster: () => string;
      };
    }).engine = {
      processCitationCluster: () => [null, [[0, "Karger (2000)", "c1"]]],
      makeCitationCluster: () => "[1]",
    };

    expect(processor.citeNarrative("karger2000")).toBe("Karger (2000)");
  });

  it("falls back to author plus suppress-author cite when author-only form is unavailable", () => {
    const processor = new CslProcessor([entry]);
    expect(processor.citeNarrative("karger2000")).toBe("Karger [1]");
  });

  it("produces author plus bracketed number for default IEEE numeric style", () => {
    // Regression: numeric styles like IEEE must use suppress-author fallback
    // (e.g. "Karger [1]"), not the author-year format "Karger (2000)".
    // See #359.
    const processor = new CslProcessor([entry]);
    const result = processor.citeNarrative("karger2000");
    expect(result).toBe("Karger [1]");
    expect(result).not.toContain("(2000)");
  });

  it("falls back to author (year) only when engine is null", () => {
    // The Author (Year) catch-all should only trigger when the engine
    // is unavailable, not when the style is numeric.
    const processor = new CslProcessor([entry]);
    // Force engine to null to simulate init failure
    (processor as unknown as { engine: null }).engine = null;
    expect(processor.citeNarrative("karger2000")).toBe("Karger (2000)");
  });

  it("falls back to author (year) when all citeproc calls throw", () => {
    const processor = new CslProcessor([entry]);
    (processor as unknown as {
      engine: {
        processCitationCluster: () => never;
        makeCitationCluster: () => never;
      };
    }).engine = {
      processCitationCluster: () => { throw new Error("citeproc error"); },
      makeCitationCluster: () => { throw new Error("citeproc error"); },
    };
    expect(processor.citeNarrative("karger2000")).toBe("Karger (2000)");
  });

  it("registers narrative citations in document order too", () => {
    const processor = {
      registerCitations: (clusters: Array<{ ids: string[] }>) => {
        expect(clusters).toEqual([
          { ids: ["karger2000"] },
          { ids: ["stein2001"] },
        ]);
      },
    } as unknown as CslProcessor;

    registerCitationsWithProcessor(
      [
        { ids: ["karger2000"] },
        { ids: ["stein2001"] },
      ],
      processor,
    );
  });
});
