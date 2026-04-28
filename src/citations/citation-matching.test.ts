import { describe, expect, it } from "vitest";
import type { CitationIdLookup } from "./citation-matching";
import {
  collectCitationBacklinkIndexFromReferences,
  collectCitationBacklinksFromTokens,
} from "./citation-matching";

const store: CitationIdLookup = {
  has: (id) => id === "alpha" || id === "beta",
};

describe("citation backlink aggregation", () => {
  it("aggregates reference backlinks with stable occurrences and duplicate ids", () => {
    const backlinks = collectCitationBacklinkIndexFromReferences([
      {
        from: 10,
        to: 20,
        ids: ["alpha", "missing", "alpha"],
        locators: [],
      },
      {
        from: 30,
        to: 40,
        ids: ["missing"],
        locators: [],
      },
      {
        from: 50,
        to: 60,
        ids: ["beta", "alpha"],
        locators: [],
      },
    ], store).backlinks;

    expect(backlinks.get("alpha")).toEqual([
      { occurrence: 1, from: 10, to: 20 },
      { occurrence: 1, from: 10, to: 20 },
      { occurrence: 2, from: 50, to: 60 },
    ]);
    expect(backlinks.get("beta")).toEqual([
      { occurrence: 2, from: 50, to: 60 },
    ]);
    expect(backlinks.has("missing")).toBe(false);
  });

  it("aggregates token backlinks with stable occurrences and duplicate ids", () => {
    const backlinks = collectCitationBacklinksFromTokens([
      {
        id: "alpha",
        clusterFrom: 100,
        clusterTo: 110,
        clusterIndex: 2,
      },
      {
        id: "beta",
        clusterFrom: 100,
        clusterTo: 110,
        clusterIndex: 0,
      },
      {
        id: "alpha",
        clusterFrom: 50,
        clusterTo: 60,
        clusterIndex: 0,
      },
      {
        id: "missing",
        clusterFrom: 75,
        clusterTo: 85,
        clusterIndex: 0,
      },
      {
        id: "alpha",
        clusterFrom: 100,
        clusterTo: 110,
        clusterIndex: 1,
      },
    ], store);

    expect(backlinks.get("alpha")).toEqual([
      { occurrence: 1, from: 50, to: 60 },
      { occurrence: 2, from: 100, to: 110 },
      { occurrence: 2, from: 100, to: 110 },
    ]);
    expect(backlinks.get("beta")).toEqual([
      { occurrence: 2, from: 100, to: 110 },
    ]);
    expect(backlinks.has("missing")).toBe(false);
  });
});
