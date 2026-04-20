import { describe, expect, it } from "vitest";

import type { CslJsonItem } from "./bibtex-parser";
import { CslProcessor } from "./csl-processor";

function makeEntry(id: string, year: number): CslJsonItem {
  return {
    author: [{ family: id }],
    id,
    issued: { "date-parts": [[year]] },
    title: `Title ${id}`,
    type: "article-journal",
  };
}

describe("CslProcessor", () => {
  it("renders registered sub-cluster items with their document citation numbers", async () => {
    const processor = await CslProcessor.create([
      makeEntry("first", 2020),
      makeEntry("second", 2021),
      makeEntry("third", 2022),
      makeEntry("cluster-a", 2023),
      makeEntry("cluster-b", 2024),
    ]);

    processor.registerCitations([
      { ids: ["first"] },
      { ids: ["second"] },
      { ids: ["third"] },
      { ids: ["cluster-a", "cluster-b"] },
    ]);

    expect(processor.cite(["cluster-a", "cluster-b"])).toBe("[4, 5]");
    expect(processor.cite(["cluster-a"])).toBe("[4]");
    expect(processor.cite(["cluster-b"])).toBe("[5]");
  });
});
