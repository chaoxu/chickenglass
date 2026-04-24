import { describe, expect, it } from "vitest";

import { collectSourceBlockRanges } from "./markdown/block-scanner";
import { assignSourceBlockRangesToModelBlocks } from "./source-block-position-assignment";

describe("assignSourceBlockRangesToModelBlocks", () => {
  it("keeps duplicate raw blocks tied to model identity", () => {
    const repeated = [
      "::: {.proof}",
      "same",
      ":::",
    ].join("\n");
    const doc = [repeated, "", repeated].join("\n");
    const ranges = collectSourceBlockRanges(doc);

    const assignments = assignSourceBlockRangesToModelBlocks([
      { nodeKey: "first", raw: repeated, variant: "fenced-div" },
      { nodeKey: "second", raw: repeated, variant: "fenced-div" },
    ], ranges);

    expect(assignments.get("first")).toMatchObject({ from: 0 });
    expect(assignments.get("second")).toMatchObject({ from: doc.lastIndexOf(repeated) });
  });

  it("does not depend on rendered DOM order", () => {
    const first = [
      "::: {.theorem}",
      "first",
      ":::",
    ].join("\n");
    const second = [
      "::: {.proof}",
      "second",
      ":::",
    ].join("\n");
    const doc = [first, "", second].join("\n");
    const ranges = collectSourceBlockRanges(doc);

    const assignments = assignSourceBlockRangesToModelBlocks([
      { nodeKey: "model-a", raw: first, variant: "fenced-div" },
      { nodeKey: "model-b", raw: second, variant: "fenced-div" },
    ], ranges);
    const renderedOrder = ["model-b", "model-a"];

    expect(renderedOrder.map((key) => assignments.get(key)?.from)).toEqual([
      doc.indexOf(second),
      doc.indexOf(first),
    ]);
  });

  it("assigns mixed table and raw block ranges by model metadata", () => {
    const doc = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "$$",
      "x",
      "$$",
    ].join("\n");
    const ranges = collectSourceBlockRanges(doc);

    const assignments = assignSourceBlockRangesToModelBlocks([
      { nodeKey: "table", variant: "table" },
      { nodeKey: "math", raw: "$$\nx\n$$", variant: "display-math" },
    ], ranges);

    expect(assignments.get("table")).toMatchObject({ from: 0 });
    expect(assignments.get("math")).toMatchObject({ from: doc.indexOf("$$\nx\n$$") });
  });
});
