import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  headingAncestryAt,
  activeHeadingIndex,
  type HeadingEntry,
} from "./heading-ancestry";
import { createEditor } from "../editor";

/** Helper: create an editor with the given markdown and extract headings. */
function headingsFrom(doc: string): HeadingEntry[] {
  const parent = document.createElement("div");
  const view = createEditor({ parent, doc });
  const headings = extractHeadings(view.state);
  view.destroy();
  return headings;
}

describe("extractHeadings", () => {
  it("extracts headings with correct levels and numbers", () => {
    const headings = headingsFrom("# Intro\n\n## Methods\n\n## Results\n");

    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: "Intro", number: "1" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Methods", number: "1.1" });
    expect(headings[2]).toMatchObject({ level: 2, text: "Results", number: "1.2" });
  });

  it("handles deeply nested headings", () => {
    const headings = headingsFrom("# A\n\n## B\n\n### C\n");

    expect(headings).toHaveLength(3);
    expect(headings[2]).toMatchObject({ level: 3, text: "C", number: "1.1.1" });
  });

  it("returns empty array for documents with no headings", () => {
    const headings = headingsFrom("Just some text\n\nMore text\n");
    expect(headings).toHaveLength(0);
  });

  it("resets sub-counters when a new sibling heading appears", () => {
    const headings = headingsFrom(
      "# A\n\n## B\n\n### C\n\n## D\n\n### E\n",
    );

    expect(headings[3]).toMatchObject({ level: 2, text: "D", number: "1.2" });
    expect(headings[4]).toMatchObject({ level: 3, text: "E", number: "1.2.1" });
  });

  it("gives empty number to headings with {-} attribute", () => {
    const headings = headingsFrom(
      "# Intro\n\n# Acknowledgments {-}\n\n# Methods\n",
    );

    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: "Intro", number: "1" });
    expect(headings[1]).toMatchObject({
      level: 1,
      text: "Acknowledgments",
      number: "",
    });
    expect(headings[2]).toMatchObject({ level: 1, text: "Methods", number: "2" });
  });

  it("gives empty number to headings with {.unnumbered} attribute", () => {
    const headings = headingsFrom(
      "# Intro\n\n# Acknowledgments {.unnumbered}\n\n# Methods\n",
    );

    expect(headings).toHaveLength(3);
    expect(headings[1]).toMatchObject({
      level: 1,
      text: "Acknowledgments",
      number: "",
    });
    expect(headings[2]).toMatchObject({ level: 1, text: "Methods", number: "2" });
  });

  it("strips attribute block from heading text", () => {
    const headings = headingsFrom("# Title {-}\n\n## Sub {.unnumbered}\n");

    expect(headings[0].text).toBe("Title");
    expect(headings[1].text).toBe("Sub");
  });

  it("unnumbered headings do not affect counter state", () => {
    const headings = headingsFrom(
      "# One\n\n## Sub A\n\n## Aside {-}\n\n## Sub B\n\n# Two\n",
    );

    expect(headings).toHaveLength(5);
    expect(headings[2]).toMatchObject({ text: "Aside", number: "" });
    // Sub B should be 1.2, not 1.3
    expect(headings[3]).toMatchObject({ text: "Sub B", number: "1.2" });
    expect(headings[4]).toMatchObject({ text: "Two", number: "2" });
  });

  it("unnumbered headings still appear in the outline", () => {
    const headings = headingsFrom(
      "# Chapter\n\n## Regular\n\n## Appendix {-}\n",
    );

    expect(headings).toHaveLength(3);
    expect(headings[2]).toMatchObject({
      level: 2,
      text: "Appendix",
      number: "",
    });
  });
});

describe("headingAncestryAt", () => {
  const headings: HeadingEntry[] = [
    { level: 1, text: "A", number: "1", pos: 0 },
    { level: 2, text: "B", number: "1.1", pos: 10 },
    { level: 2, text: "C", number: "1.2", pos: 30 },
    { level: 3, text: "D", number: "1.2.1", pos: 50 },
  ];

  it("returns empty when cursor is before all headings", () => {
    // pos: -1 would mean before any heading if headings start at 0
    // But since heading at pos 0, cursor at -1 means before
    // Let's use headings that don't start at 0
    const h: HeadingEntry[] = [
      { level: 1, text: "A", number: "1", pos: 5 },
    ];
    expect(headingAncestryAt(h, 3)).toEqual([]);
  });

  it("returns single heading when cursor is in first section", () => {
    const ancestry = headingAncestryAt(headings, 5);
    expect(ancestry).toEqual([headings[0]]);
  });

  it("returns parent + child for nested cursor position", () => {
    const ancestry = headingAncestryAt(headings, 15);
    expect(ancestry).toHaveLength(2);
    expect(ancestry[0].text).toBe("A");
    expect(ancestry[1].text).toBe("B");
  });

  it("picks the correct sibling heading", () => {
    const ancestry = headingAncestryAt(headings, 35);
    expect(ancestry).toHaveLength(2);
    expect(ancestry[0].text).toBe("A");
    expect(ancestry[1].text).toBe("C");
  });

  it("returns full 3-level ancestry", () => {
    const ancestry = headingAncestryAt(headings, 55);
    expect(ancestry).toHaveLength(3);
    expect(ancestry[0].text).toBe("A");
    expect(ancestry[1].text).toBe("C");
    expect(ancestry[2].text).toBe("D");
  });

  it("includes heading when cursor is exactly on its position", () => {
    const ancestry = headingAncestryAt(headings, 50);
    expect(ancestry).toHaveLength(3);
    expect(ancestry[2].text).toBe("D");
  });

  it("matches the legacy filtered walk on heading-heavy documents", () => {
    const denseHeadings: HeadingEntry[] = Array.from({ length: 10_000 }, (_, index) => ({
      level: (index % 6) + 1,
      text: `H${index}`,
      number: String(index + 1),
      pos: index * 10,
    }));
    const legacyAncestryAt = (cursorPos: number): HeadingEntry[] => {
      const before = denseHeadings.filter((heading) => heading.pos <= cursorPos);
      const ancestry: HeadingEntry[] = [];
      let currentLevel = Infinity;
      for (let index = before.length - 1; index >= 0; index -= 1) {
        const heading = before[index];
        if (heading.level < currentLevel) {
          ancestry.unshift(heading);
          currentLevel = heading.level;
          if (currentLevel === 1) break;
        }
      }
      return ancestry;
    };

    for (const cursorPos of [0, 25_000, 55_555, 99_999]) {
      expect(headingAncestryAt(denseHeadings, cursorPos)).toEqual(
        legacyAncestryAt(cursorPos),
      );
    }
  });
});

describe("activeHeadingIndex", () => {
  const headings: HeadingEntry[] = [
    { level: 1, text: "A", number: "1", pos: 0 },
    { level: 2, text: "B", number: "1.1", pos: 10 },
    { level: 2, text: "C", number: "1.2", pos: 30 },
  ];

  it("returns -1 when cursor is before all headings", () => {
    const h: HeadingEntry[] = [
      { level: 1, text: "A", number: "1", pos: 5 },
    ];
    expect(activeHeadingIndex(h, 3)).toBe(-1);
  });

  it("returns the last heading before cursor", () => {
    expect(activeHeadingIndex(headings, 15)).toBe(1);
    expect(activeHeadingIndex(headings, 35)).toBe(2);
  });

  it("returns first heading when cursor is at its position", () => {
    expect(activeHeadingIndex(headings, 0)).toBe(0);
  });

  it("returns -1 for empty headings array", () => {
    expect(activeHeadingIndex([], 5)).toBe(-1);
  });
});
