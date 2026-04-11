import { describe, expect, it } from "vitest";

import { buildRenderIndex } from "./reference-index";

describe("buildRenderIndex", () => {
  it("shares theorem-family counters and keeps dedicated definition/algorithm counters", () => {
    const doc = [
      "::: {.theorem #thm:a} A",
      "Body",
      ":::",
      "",
      "::: {.lemma #lem:b} B",
      "Body",
      ":::",
      "",
      "::: {.problem #prob:c} C",
      "Body",
      ":::",
      "",
      "::: {.definition #def:d} D",
      "Body",
      ":::",
      "",
      "::: {.algorithm #alg:e} E",
      "Body",
      ":::",
    ].join("\n");

    const index = buildRenderIndex(doc);

    expect(index.references.get("thm:a")?.label).toBe("Theorem 1");
    expect(index.references.get("lem:b")?.label).toBe("Lemma 2");
    expect(index.references.get("prob:c")?.label).toBe("Problem 3");
    expect(index.references.get("def:d")?.label).toBe("Definition 1");
    expect(index.references.get("alg:e")?.label).toBe("Algorithm 1");
  });

  it("honors frontmatter block overrides and global numbering", () => {
    const doc = [
      "::: {.problem #prob:a} A",
      "Body",
      ":::",
      "",
      "::: {.problem #prob:b} B",
      "Body",
      ":::",
    ].join("\n");

    const index = buildRenderIndex(doc, {
      blocks: {
        problem: {
          counter: "custom-problem",
          title: "Exercise",
        },
      },
      numbering: "global",
    });

  expect(index.references.get("prob:a")?.label).toBe("Exercise 1");
  expect(index.references.get("prob:b")?.label).toBe("Exercise 2");
  });
});
