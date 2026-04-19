import { describe, expect, it } from "vitest";

import {
  HEADING_SOURCE_SELECTOR,
  rawBlockSourceAttrs,
  RAW_BLOCK_SOURCE_SELECTOR,
  SOURCE_POSITION_ATTR,
  SOURCE_POSITION_SELECTOR,
  TABLE_BLOCK_SOURCE_SELECTOR,
} from "./source-position-contract";

describe("source-position-contract", () => {
  it("exports selectors matching emitted raw-block attributes", () => {
    const element = document.createElement("section");
    Object.entries(rawBlockSourceAttrs("fenced-div", true)).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });

    expect(element.matches(RAW_BLOCK_SOURCE_SELECTOR)).toBe(true);
    expect(element.getAttribute(SOURCE_POSITION_ATTR.rawBlockVariant)).toBe("fenced-div");
    expect(element.getAttribute(SOURCE_POSITION_ATTR.rawBlockFallback)).toBe("true");
  });

  it("exports selectors matching table, heading, and source-position attributes", () => {
    const table = document.createElement("table");
    table.setAttribute(SOURCE_POSITION_ATTR.tableBlock, "true");
    table.setAttribute(SOURCE_POSITION_ATTR.sourceFrom, "10");

    const heading = document.createElement("h1");
    heading.className = "cf-lexical-heading";
    heading.setAttribute(SOURCE_POSITION_ATTR.headingPos, "20");

    expect(table.matches(TABLE_BLOCK_SOURCE_SELECTOR)).toBe(true);
    expect(table.matches(SOURCE_POSITION_SELECTOR)).toBe(true);
    expect(heading.matches(HEADING_SOURCE_SELECTOR)).toBe(true);
    expect(heading.matches(SOURCE_POSITION_SELECTOR)).toBe(true);
  });
});
