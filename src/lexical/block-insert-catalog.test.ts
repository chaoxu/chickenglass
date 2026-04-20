import { describe, expect, it } from "vitest";

import {
  BLOCK_MANIFEST,
  isGenericFencedDivInsertBlock,
} from "../constants/block-manifest";
import {
  createFencedDivInsertSpec,
  createTableInsertSpec,
  DISPLAY_MATH_DOLLAR_INSERT_SPEC,
  FENCED_DIV_INSERT_KEYWORDS,
  SLASH_INSERT_SPECS,
} from "./block-insert-catalog";

describe("block-insert-catalog", () => {
  it("uses the same display-math template for slash and markdown expansion", () => {
    expect(SLASH_INSERT_SPECS.find((spec) => spec.id === "display-math")).toMatchObject({
      focusTarget: DISPLAY_MATH_DOLLAR_INSERT_SPEC.focusTarget,
      raw: DISPLAY_MATH_DOLLAR_INSERT_SPEC.raw,
      variant: DISPLAY_MATH_DOLLAR_INSERT_SPEC.variant,
    });
  });

  it("builds fenced div expansion specs from the typed opener", () => {
    expect(createFencedDivInsertSpec('::: {.theorem title="Title"}')).toMatchObject({
      focusTarget: "block-body",
      raw: '::: {.theorem title="Title"}\n\n:::',
      variant: "fenced-div",
    });

    expect(createFencedDivInsertSpec(":::: {.custom-note}")).toMatchObject({
      focusTarget: "block-body",
      raw: ":::: {.custom-note}\n\n::::",
      variant: "fenced-div",
    });
  });

  it("derives manifest-backed fenced-div insertion keywords from the block manifest", () => {
    const manifestBlockNames = BLOCK_MANIFEST
      .filter(isGenericFencedDivInsertBlock)
      .map((entry) => entry.name);
    expect(FENCED_DIV_INSERT_KEYWORDS).toEqual(expect.arrayContaining(manifestBlockNames));
    expect(FENCED_DIV_INSERT_KEYWORDS).not.toContain("custom-note");

    const fencedDivSpec = SLASH_INSERT_SPECS.find((spec) => spec.id === "fenced-div");
    expect(fencedDivSpec?.keywords).toBe(FENCED_DIV_INSERT_KEYWORDS);
    expect(fencedDivSpec?.raw).toBe("::: {.theorem}\n\n:::");
  });

  it("keeps non-manifest raw insertion entries explicit", () => {
    expect(SLASH_INSERT_SPECS.map((spec) => spec.id)).toEqual(expect.arrayContaining([
      "table",
      "display-math",
      "footnote-definition",
    ]));
  });

  it("preserves table placeholder behavior for sparse header lines", () => {
    expect(createTableInsertSpec("| A | B |", "| --- | --- |")).toMatchObject({
      focusTarget: "table-cell",
      raw: "| A | B |\n| --- | --- |\n|  |  |",
      variant: "table",
    });

    expect(createTableInsertSpec("|", "| --- |")).toMatchObject({
      raw: "|\n| --- |\n|  |",
    });
  });
});
