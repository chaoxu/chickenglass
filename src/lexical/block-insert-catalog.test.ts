import { describe, expect, it } from "vitest";

import {
  createFencedDivInsertSpec,
  createTableInsertSpec,
  DISPLAY_MATH_DOLLAR_INSERT_SPEC,
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
    expect(createFencedDivInsertSpec(":::: {.include}")).toMatchObject({
      focusTarget: "include-path",
      raw: ":::: {.include}\n\n::::",
      variant: "fenced-div",
    });

    expect(createFencedDivInsertSpec("::: {.theorem} Title")).toMatchObject({
      focusTarget: "block-body",
      raw: "::: {.theorem} Title\n\n:::",
      variant: "fenced-div",
    });
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
