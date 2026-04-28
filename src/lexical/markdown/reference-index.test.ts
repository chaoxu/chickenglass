import { describe, expect, it } from "vitest";

import { buildRenderIndex } from "./reference-index";

describe("buildRenderIndex", () => {
  it("uses configured counter groups by default", () => {
    const doc = [
      '::: {.theorem #thm:a title="A"}',
      "Body",
      ":::",
      "",
      '::: {.lemma #lem:b title="B"}',
      "Body",
      ":::",
      "",
      '::: {.problem #prob:c title="C"}',
      "Body",
      ":::",
      "",
      '::: {.definition #def:d title="D"}',
      "Body",
      ":::",
      "",
      '::: {.algorithm #alg:e title="E"}',
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
      '::: {.problem #prob:a title="A"}',
      "Body",
      ":::",
      "",
      '::: {.problem #prob:b title="B"}',
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

  it("treats counter null as a per-block counter group", () => {
    const doc = [
      '::: {.problem #prob:a title="A"}',
      "Body",
      ":::",
      "",
      '::: {.lemma #lem:b title="B"}',
      "Body",
      ":::",
      "",
      '::: {.problem #prob:c title="C"}',
      "Body",
      ":::",
    ].join("\n");

    const index = buildRenderIndex(doc, {
      blocks: {
        problem: {
          counter: null,
        },
      },
    });

    expect(index.references.get("prob:a")?.label).toBe("Problem 1");
    expect(index.references.get("lem:b")?.label).toBe("Lemma 1");
    expect(index.references.get("prob:c")?.label).toBe("Problem 2");
  });
});
