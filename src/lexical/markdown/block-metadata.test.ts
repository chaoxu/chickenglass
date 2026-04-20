import { describe, expect, it } from "vitest";

import { humanizeBlockType, resolveBlockNumbering, resolveBlockTitle } from "./block-metadata";

describe("block-metadata", () => {
  it("humanizes block types and honors frontmatter title overrides", () => {
    expect(humanizeBlockType(undefined)).toBe("Block");
    expect(humanizeBlockType("problem")).toBe("Problem");
    expect(resolveBlockTitle("problem", {
      blocks: {
        problem: {
          title: "Exercise",
        },
      },
    })).toBe("Exercise");
  });

  it("respects numbering defaults and global numbering", () => {
    expect(resolveBlockNumbering("proof")).toEqual({ numbered: false });
    expect(resolveBlockNumbering("custom-note")).toEqual({
      counterGroup: "custom-note",
      numbered: true,
    });
    expect(resolveBlockNumbering("problem", {
      blocks: {
        problem: {
          counter: "custom-problem",
        },
      },
      numbering: "global",
    })).toEqual({
      counterGroup: "__global__",
      numbered: true,
    });
  });
});
