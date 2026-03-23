import { describe, expect, it, vi } from "vitest";
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

describe("CslProcessor corporate authors", () => {
  // Regression: citeNarrative must not produce "undefined" for corporate
  // authors. CSL-JSON represents corporate/institutional authors with a
  // `literal` field and no `family`/`given`. See #346.
  it("uses literal field for corporate author narrative citation", () => {
    const entry: CslJsonItem = {
      id: "ieee2023",
      type: "report",
      author: [{ literal: "IEEE Computer Society" }],
      title: "Some Standard",
      issued: { "date-parts": [[2023]] },
    };
    const processor = new CslProcessor([entry]);
    // Force engine to null so we hit the plain author+year fallback.
    (processor as unknown as { engine: null }).engine = null;
    const result = processor.citeNarrative("ieee2023");
    expect(result).not.toContain("undefined");
    expect(result).toContain("IEEE Computer Society");
  });

  it("falls back to item id when all author name fields are absent", () => {
    const entry: CslJsonItem = {
      id: "anon2020",
      type: "article-journal",
      // Empty author objects — no literal, family, or given.
      author: [{} as { family?: string; given?: string; literal?: string }],
      issued: { "date-parts": [[2020]] },
    };
    const processor = new CslProcessor([entry]);
    (processor as unknown as { engine: null }).engine = null;
    const result = processor.citeNarrative("anon2020");
    expect(result).not.toContain("undefined");
    expect(result).toContain("anon2020");
  });

  it("handles mixed individual and corporate authors without undefined", () => {
    const entry: CslJsonItem = {
      id: "mixed2021",
      type: "report",
      author: [
        { family: "Smith", given: "John" },
        { literal: "IETF" },
      ],
      issued: { "date-parts": [[2021]] },
    };
    const processor = new CslProcessor([entry]);
    (processor as unknown as { engine: null }).engine = null;
    const result = processor.citeNarrative("mixed2021");
    expect(result).not.toContain("undefined");
    expect(result).toContain("Smith");
    expect(result).toContain("IETF");
  });
});

describe("CslProcessor ordering", () => {
  it("does not register a failed citation cluster as prior context", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const processor = CslProcessor.empty() as unknown as {
      registerCitations: CslProcessor["registerCitations"];
      engine: {
        updateItems: (ids: string[]) => void;
        processCitationCluster: ReturnType<typeof vi.fn>;
      };
    };
    const processCitationCluster = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("bad cluster");
      })
      .mockReturnValueOnce(undefined);
    processor.engine = {
      updateItems: vi.fn(),
      processCitationCluster,
    };

    try {
      processor.registerCitations([
        { ids: ["bad"] },
        { ids: ["good"] },
      ]);
    } finally {
      warn.mockRestore();
    }

    expect(processCitationCluster.mock.calls[1][0]).toEqual(
      expect.objectContaining({ citationID: "cite-1" }),
    );
    expect(processCitationCluster.mock.calls[1][1]).not.toContainEqual(["cite-0", 0]);
  });

  it("preserves registered numbering context when rendering the bibliography", () => {
    const processor = new CslProcessor([
      { id: "karger2000", type: "article-journal" as const },
    ]) as unknown as {
      bibliography: CslProcessor["bibliography"];
      engine: {
        updateItems: ReturnType<typeof vi.fn>;
        makeBibliography: ReturnType<typeof vi.fn>;
      };
    };
    const updateItems = vi.fn();
    processor.engine = {
      updateItems,
      makeBibliography: vi.fn(() => [{}, ["  <span class=\"csl-entry\">[1] Entry</span>  "]]),
    };

    const entries = processor.bibliography(["karger2000"]);

    expect(entries).toEqual(['<span class="csl-entry">[1] Entry</span>']);
    expect(updateItems).not.toHaveBeenCalled();
  });
});
