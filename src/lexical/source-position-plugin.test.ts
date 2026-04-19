import { describe, expect, it } from "vitest";

import { syncSourceBlockPositions } from "./source-position-plugin";

describe("syncSourceBlockPositions", () => {
  it("keeps later source-block offsets aligned when a native table sits between raw blocks", () => {
    const root = document.createElement("div");
    root.className = "cf-lexical-root";
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
    expect(frontmatter.dataset.coflatSourceTo).toBe(String(doc.indexOf("---", 3) + 3));
    expect(table.dataset.coflatSourceFrom).toBe(String(doc.indexOf("| A | B |")));
    expect(displayMath.dataset.coflatSourceFrom).toBe(String(doc.indexOf("$$\nx\n$$")));
  });

  it("ignores raw blocks owned by nested editor roots", () => {
    const root = document.createElement("div");
    root.className = "cf-lexical-root";
    const theorem = document.createElement("section");
    theorem.dataset.coflatRawBlock = "true";
    const nestedRoot = document.createElement("div");
    nestedRoot.className = "cf-lexical-root";
    const nestedDisplayMath = document.createElement("section");
    nestedDisplayMath.dataset.coflatRawBlock = "true";
    nestedRoot.append(nestedDisplayMath);
    theorem.append(nestedRoot);
    const topLevelDisplayMath = document.createElement("section");
    topLevelDisplayMath.dataset.coflatRawBlock = "true";
    root.append(theorem, topLevelDisplayMath);

    const doc = [
      "::: {.theorem}",
      "$$",
      "nested",
      "$$",
      ":::",
      "",
      "$$",
      "top",
      "$$",
    ].join("\n");

    syncSourceBlockPositions(root, doc);

    expect(theorem.dataset.coflatSourceFrom).toBe(String(doc.indexOf("::: {.theorem}")));
    expect(nestedDisplayMath.dataset.coflatSourceFrom).toBeUndefined();
    expect(topLevelDisplayMath.dataset.coflatSourceFrom).toBe(String(doc.lastIndexOf("$$\ntop\n$$")));
  });
});
