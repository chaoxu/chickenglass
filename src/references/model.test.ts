import { describe, expect, it } from "vitest";
import type { ReferenceEntry, ReferenceIndexModel } from "./model";

describe("ReferenceIndexModel", () => {
  it("constructs one entry of each reference type", () => {
    const model: ReferenceIndexModel = new Map<string, ReferenceEntry>([
      [
        "cite:knuth1990",
        {
          id: "cite:knuth1990",
          type: "citation",
          sourceRange: { from: 4, to: 19 },
          display: "Knuth (1990)",
          target: null,
        },
      ],
      [
        "sec:intro",
        {
          id: "sec:intro",
          type: "crossref",
          targetKind: "heading",
          sourceRange: { from: 28, to: 38 },
          display: "Section 1",
          target: {
            path: "notes/main.md",
            range: { from: 120, to: 145 },
          },
        },
      ],
      [
        "eq:main",
        {
          id: "eq:main",
          type: "label",
          targetKind: "equation",
          sourceRange: { from: 60, to: 69 },
          display: "Eq. (1)",
          target: {
            path: "notes/main.md",
            range: { from: 200, to: 214 },
          },
        },
      ],
    ]);

    expect(model.size).toBe(3);
    expect([...model.values()].map((entry) => entry.type)).toEqual([
      "citation",
      "crossref",
      "label",
    ]);
    expect(model.get("cite:knuth1990")?.target).toBeNull();
    expect(model.get("sec:intro")?.target?.path).toBe("notes/main.md");
    expect(model.get("eq:main")?.display).toBe("Eq. (1)");
  });
});
