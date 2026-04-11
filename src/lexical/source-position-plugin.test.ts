import { describe, expect, it } from "vitest";

import { syncSourceBlockPositions } from "./source-position-plugin";

describe("syncSourceBlockPositions", () => {
  it("keeps later source-block offsets aligned when a native table sits between raw blocks", () => {
    const root = document.createElement("div");
    const frontmatter = document.createElement("section");
    frontmatter.dataset.coflatRawBlock = "true";
    const table = document.createElement("table");
    table.dataset.coflatTableBlock = "true";
    const displayMath = document.createElement("section");
    displayMath.dataset.coflatRawBlock = "true";

    root.append(frontmatter, table, displayMath);

    const doc = [
      "---",
      "title: Source Map",
      "---",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "$$",
      "x",
      "$$",
    ].join("\n");

    syncSourceBlockPositions(root, doc);

    expect(frontmatter.dataset.coflatSourceFrom).toBe(String(doc.indexOf("---")));
    expect(table.dataset.coflatSourceFrom).toBe(String(doc.indexOf("| A | B |")));
    expect(displayMath.dataset.coflatSourceFrom).toBe(String(doc.indexOf("$$\nx\n$$")));
  });
});
