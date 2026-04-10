import { describe, expect, it } from "vitest";

import {
  activeHeadingIndex,
  extractHeadings,
  headingAncestryAt,
  type HeadingEntry,
} from "./heading-ancestry";

function headingsFrom(doc: string): HeadingEntry[] {
  return extractHeadings(doc);
}

describe("extractHeadings", () => {
  it("extracts headings with correct levels and numbers", () => {
    const headings = headingsFrom("# Intro\n\n## Methods\n\n## Results\n");

    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: "Intro", number: "1" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Methods", number: "1.1" });
    expect(headings[2]).toMatchObject({ level: 2, text: "Results", number: "1.2" });
  });

  it("preserves unnumbered headings without advancing counters", () => {
    const headings = headingsFrom("# One\n\n## Sub A\n\n## Aside {-}\n\n## Sub B\n");

    expect(headings[2]).toMatchObject({ text: "Aside", number: "" });
    expect(headings[3]).toMatchObject({ text: "Sub B", number: "1.2" });
  });

  it("extracts Pandoc heading ids", () => {
    const headings = headingsFrom("# Intro {#sec:intro}\n");
    expect(headings[0]).toMatchObject({ id: "sec:intro" });
  });
});

describe("headingAncestryAt", () => {
  const headings: HeadingEntry[] = [
    { level: 1, text: "A", number: "1", pos: 0 },
    { level: 2, text: "B", number: "1.1", pos: 10 },
    { level: 2, text: "C", number: "1.2", pos: 30 },
    { level: 3, text: "D", number: "1.2.1", pos: 50 },
  ];

  it("returns the active heading chain at a cursor position", () => {
    expect(headingAncestryAt(headings, 55).map((heading) => heading.text)).toEqual(["A", "C", "D"]);
  });
});

describe("activeHeadingIndex", () => {
  const headings: HeadingEntry[] = [
    { level: 1, text: "A", number: "1", pos: 0 },
    { level: 2, text: "B", number: "1.1", pos: 10 },
    { level: 2, text: "C", number: "1.2", pos: 30 },
  ];

  it("returns the last heading at or before the cursor", () => {
    expect(activeHeadingIndex(headings, 35)).toBe(2);
  });
});
