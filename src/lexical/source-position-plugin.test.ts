import { describe, expect, it } from "vitest";

import { syncSourceBlockPositions } from "./source-position-plugin";
import {
  markTableSourceBlock,
  rawBlockSourceAttrs,
  SOURCE_POSITION_DATASET,
} from "./source-position-contract";

function markRawBlock(element: HTMLElement): void {
  Object.entries(rawBlockSourceAttrs("display-math")).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
}

describe("syncSourceBlockPositions", () => {
  it("keeps later source-block offsets aligned when a native table sits between raw blocks", () => {
    const root = document.createElement("div");
    root.className = "cf-lexical-root";
    const frontmatter = document.createElement("section");
    markRawBlock(frontmatter);
    const table = document.createElement("table");
    markTableSourceBlock(table, 2);
    const displayMath = document.createElement("section");
    markRawBlock(displayMath);

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

    expect(frontmatter.dataset[SOURCE_POSITION_DATASET.sourceFrom]).toBe(String(doc.indexOf("---")));
    expect(frontmatter.dataset[SOURCE_POSITION_DATASET.sourceTo]).toBe(String(doc.indexOf("---", 3) + 3));
    expect(table.dataset[SOURCE_POSITION_DATASET.sourceFrom]).toBe(String(doc.indexOf("| A | B |")));
    expect(displayMath.dataset[SOURCE_POSITION_DATASET.sourceFrom]).toBe(String(doc.indexOf("$$\nx\n$$")));
  });

  it("ignores raw blocks owned by nested editor roots", () => {
    const root = document.createElement("div");
    root.className = "cf-lexical-root";
    const theorem = document.createElement("section");
    markRawBlock(theorem);
    const nestedRoot = document.createElement("div");
    nestedRoot.className = "cf-lexical-root";
    const nestedDisplayMath = document.createElement("section");
    markRawBlock(nestedDisplayMath);
    nestedRoot.append(nestedDisplayMath);
    theorem.append(nestedRoot);
    const topLevelDisplayMath = document.createElement("section");
    markRawBlock(topLevelDisplayMath);
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

    expect(theorem.dataset[SOURCE_POSITION_DATASET.sourceFrom]).toBe(String(doc.indexOf("::: {.theorem}")));
    expect(nestedDisplayMath.dataset[SOURCE_POSITION_DATASET.sourceFrom]).toBeUndefined();
    expect(topLevelDisplayMath.dataset[SOURCE_POSITION_DATASET.sourceFrom]).toBe(String(doc.lastIndexOf("$$\ntop\n$$")));
  });
});
