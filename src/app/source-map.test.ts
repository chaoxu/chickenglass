import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";

import { SourceMap, type IncludeRegion } from "./source-map";

/** Helper to create a ChangeSet from a document and change spec. */
function makeChanges(
  doc: string,
  changes: { from: number; to?: number; insert?: string }[],
) {
  const state = EditorState.create({ doc });
  const tr = state.update({ changes });
  return tr.changes;
}

/** Helper to create a fresh region. */
function region(
  from: number,
  to: number,
  file: string,
  originalRef?: string,
  rawFrom?: number,
  rawTo?: number,
): IncludeRegion {
  return {
    from,
    to,
    file,
    originalRef: originalRef ?? `{{include ${file}}}`,
    rawFrom: rawFrom ?? 0,
    rawTo: rawTo ?? (originalRef?.length ?? `{{include ${file}}}`.length),
  };
}

describe("SourceMap", () => {
  describe("construction and fileAt", () => {
    it("returns null for positions in the main file", () => {
      // Document: "MAIN[include1]MAIN[include2]MAIN"
      //            0   4         14  18        28  32
      const sm = new SourceMap([
        region(4, 14, "chapter1.md"),
        region(18, 28, "chapter2.md"),
      ]);
      expect(sm.fileAt(0)).toBeNull();
      expect(sm.fileAt(3)).toBeNull();
      expect(sm.fileAt(14)).toBeNull();
      expect(sm.fileAt(17)).toBeNull();
      expect(sm.fileAt(28)).toBeNull();
      expect(sm.fileAt(31)).toBeNull();
    });

    it("returns the file for positions inside regions", () => {
      const sm = new SourceMap([
        region(4, 14, "chapter1.md"),
        region(18, 28, "chapter2.md"),
      ]);
      expect(sm.fileAt(4)).toBe("chapter1.md");
      expect(sm.fileAt(9)).toBe("chapter1.md");
      expect(sm.fileAt(13)).toBe("chapter1.md");
      expect(sm.fileAt(18)).toBe("chapter2.md");
      expect(sm.fileAt(27)).toBe("chapter2.md");
    });

    it("returns null for an empty source map", () => {
      const sm = new SourceMap([]);
      expect(sm.fileAt(0)).toBeNull();
      expect(sm.fileAt(100)).toBeNull();
    });
  });

  describe("regionAt", () => {
    it("returns the region containing the position", () => {
      const r1 = region(4, 14, "chapter1.md");
      const r2 = region(18, 28, "chapter2.md");
      const sm = new SourceMap([r1, r2]);
      expect(sm.regionAt(5)).toBe(r1);
      expect(sm.regionAt(20)).toBe(r2);
    });

    it("returns null for positions outside all regions", () => {
      const sm = new SourceMap([region(4, 14, "chapter1.md")]);
      expect(sm.regionAt(0)).toBeNull();
      expect(sm.regionAt(3)).toBeNull();
      expect(sm.regionAt(14)).toBeNull();
      expect(sm.regionAt(20)).toBeNull();
    });
  });

  describe("mapThrough", () => {
    it("shifts positions for insert before regions", () => {
      // Doc: "AAbbbbCC" (A=main 0-2, b=include 2-6, C=main 6-8)
      const sm = new SourceMap([region(2, 6, "inc.md")]);
      // Insert "XX" at position 0 (before everything)
      const changes = makeChanges("AAbbbbCC", [{ from: 0, insert: "XX" }]);
      sm.mapThrough(changes);
      expect(sm.regions[0].from).toBe(4);
      expect(sm.regions[0].to).toBe(8);
    });

    it("shrinks region for delete within a region", () => {
      // Doc: "AAbbbbCC" (include at 2-6)
      const sm = new SourceMap([region(2, 6, "inc.md")]);
      // Delete "bb" at positions 3-5 (within the region)
      const changes = makeChanges("AAbbbbCC", [{ from: 3, to: 5 }]);
      sm.mapThrough(changes);
      expect(sm.regions[0].from).toBe(2);
      expect(sm.regions[0].to).toBe(4);
    });

    it("handles delete crossing a region boundary", () => {
      // Doc: "AAbbbbCCddddEE"
      //       01234567890123
      // Region1: 2-6 (bbbb), Region2: 8-12 (dddd)
      const sm = new SourceMap([
        region(2, 6, "r1.md"),
        region(8, 12, "r2.md"),
      ]);
      // Delete from 5 to 9 (crosses end of r1 and start of r2)
      const changes = makeChanges("AAbbbbCCddddEE", [{ from: 5, to: 9 }]);
      sm.mapThrough(changes);
      // r1: from=2, to maps 6 with assoc=1 -> 6 stays at 6 but delete 5..9
      // mapPos(6, 1) for delete 5..9: 6 is inside the deleted range, maps to 5
      // But assoc=1 means it goes to the right side of the deletion -> 5
      // r1: from=2, to=5
      expect(sm.regions[0].from).toBe(2);
      expect(sm.regions[0].to).toBe(5);
      // r2: from maps 8 with assoc=-1 -> 8 is inside deleted 5..9 -> maps to 5
      // to maps 12 with assoc=1 -> 12 - 4 = 8
      expect(sm.regions[1].from).toBe(5);
      expect(sm.regions[1].to).toBe(8);
    });

    it("expands region for insert at exact boundary (from)", () => {
      // Doc: "AAbbbbCC" (include at 2-6)
      const sm = new SourceMap([region(2, 6, "inc.md")]);
      // Insert "XX" at position 2 (exact start of region)
      // With assoc=-1 on from, position sticks left -> from stays at 2
      // Inserted text goes into the region
      const changes = makeChanges("AAbbbbCC", [{ from: 2, insert: "XX" }]);
      sm.mapThrough(changes);
      expect(sm.regions[0].from).toBe(2);
      expect(sm.regions[0].to).toBe(8);
    });

    it("expands region for insert at exact boundary (to)", () => {
      // Doc: "AAbbbbCC" (include at 2-6)
      const sm = new SourceMap([region(2, 6, "inc.md")]);
      // Insert "XX" at position 6 (exact end of region)
      // With assoc=1 on to, position sticks right -> to moves to 8
      const changes = makeChanges("AAbbbbCC", [{ from: 6, insert: "XX" }]);
      sm.mapThrough(changes);
      expect(sm.regions[0].from).toBe(2);
      expect(sm.regions[0].to).toBe(8);
    });

    it("preserves empty region when fully deleted", () => {
      // Doc: "AAbbCC" (include at 2-4)
      const sm = new SourceMap([region(2, 4, "inc.md")]);
      // Delete the entire region content
      const changes = makeChanges("AAbbCC", [{ from: 2, to: 4 }]);
      sm.mapThrough(changes);
      // Region becomes empty but is preserved
      expect(sm.regions[0].from).toBe(2);
      expect(sm.regions[0].to).toBe(2);
    });
  });

  describe("decompose", () => {
    it("extracts correct content for each region", () => {
      const doc = "HEADER\nChapter 1 content\nMIDDLE\nChapter 2 content\nFOOTER";
      // "HEADER\n" = 0..7
      // "Chapter 1 content\n" = 7..25
      // "MIDDLE\n" = 25..32
      // "Chapter 2 content\n" = 32..50
      // "FOOTER" = 50..56
      const sm = new SourceMap([
        region(7, 25, "chapter1.md"),
        region(32, 50, "chapter2.md"),
      ]);
      const parts = sm.decompose(doc);
      expect(parts.get("chapter1.md")).toBe("Chapter 1 content\n");
      expect(parts.get("chapter2.md")).toBe("Chapter 2 content\n");
      expect(parts.size).toBe(2);
    });

    it("returns empty string for zero-size regions", () => {
      const doc = "ABCDEF";
      const sm = new SourceMap([region(3, 3, "empty.md")]);
      const parts = sm.decompose(doc);
      expect(parts.get("empty.md")).toBe("");
    });

    it("returns empty map when there are no regions", () => {
      const sm = new SourceMap([]);
      const parts = sm.decompose("some document content");
      expect(parts.size).toBe(0);
    });
  });

  describe("reconstructMain", () => {
    it("replaces region content with original references", () => {
      const doc = "HEADER\nincluded text\nFOOTER";
      // "HEADER\n" = 0..7
      // "included text\n" = 7..21
      // "FOOTER" = 21..27
      const sm = new SourceMap([
        region(7, 21, "chapter.md", "{{include chapter.md}}"),
      ]);
      const result = sm.reconstructMain(doc, "main.md");
      expect(result).toBe("HEADER\n{{include chapter.md}}FOOTER");
    });

    it("handles multiple regions", () => {
      const doc2 = "AAincluded1BBincluded2CC";
      //             01234567890123456789012
      // AA = 0..2, included1 = 2..11, BB = 11..13, included2 = 13..22, CC = 22..24
      const sm = new SourceMap([
        region(2, 11, "file1.md", "{{file1}}"),
        region(13, 22, "file2.md", "{{file2}}"),
      ]);
      const result = sm.reconstructMain(doc2, "main.md");
      expect(result).toBe("AA{{file1}}BB{{file2}}CC");
    });

    it("round-trips: compose then reconstruct produces original main", () => {
      // Original main file with include references
      const originalMain =
        "# My Document\n{{include intro.md}}\n## Methods\n{{include methods.md}}\n## Conclusion\n";

      // Simulated composed document (includes expanded)
      const introContent = "This is the introduction.\n";
      const methodsContent = "We used these methods.\n";

      // Build composed document
      const beforeIntro = "# My Document\n";
      const betweenIncludes = "\n## Methods\n";
      const afterMethods = "\n## Conclusion\n";

      const composed =
        beforeIntro +
        introContent +
        betweenIncludes +
        methodsContent +
        afterMethods;

      const introFrom = beforeIntro.length;
      const introTo = introFrom + introContent.length;
      const methodsFrom = introTo + betweenIncludes.length;
      const methodsTo = methodsFrom + methodsContent.length;

      const sm = new SourceMap([
        region(
          introFrom,
          introTo,
          "intro.md",
          "{{include intro.md}}",
          beforeIntro.length,
          beforeIntro.length + "{{include intro.md}}".length,
        ),
        region(
          methodsFrom,
          methodsTo,
          "methods.md",
          "{{include methods.md}}",
          beforeIntro.length +
            "{{include intro.md}}".length +
            betweenIncludes.length,
          beforeIntro.length +
            "{{include intro.md}}".length +
            betweenIncludes.length +
            "{{include methods.md}}".length,
        ),
      ]);

      const reconstructed = sm.reconstructMain(composed, "main.md");
      expect(reconstructed).toBe(originalMain);
    });
  });

  describe("multiple regions", () => {
    it("handles three includes in a single document", () => {
      // Doc: "H-aaa-M-bbb-M-ccc-F"
      // More precisely:
      const header = "HEADER\n";
      const inc1 = "content of file 1\n";
      const mid1 = "MIDDLE1\n";
      const inc2 = "content of file 2\n";
      const mid2 = "MIDDLE2\n";
      const inc3 = "content of file 3\n";
      const footer = "FOOTER\n";

      const doc = header + inc1 + mid1 + inc2 + mid2 + inc3 + footer;

      let pos = header.length;
      const r1 = region(pos, pos + inc1.length, "f1.md", "{{f1}}");
      pos += inc1.length + mid1.length;
      const r2 = region(pos, pos + inc2.length, "f2.md", "{{f2}}");
      pos += inc2.length + mid2.length;
      const r3 = region(pos, pos + inc3.length, "f3.md", "{{f3}}");

      const sm = new SourceMap([r1, r2, r3]);

      // fileAt checks
      expect(sm.fileAt(0)).toBeNull(); // header
      expect(sm.fileAt(header.length)).toBe("f1.md");
      expect(sm.fileAt(header.length + inc1.length)).toBeNull(); // mid1
      expect(sm.fileAt(header.length + inc1.length + mid1.length)).toBe(
        "f2.md",
      );
      expect(
        sm.fileAt(
          header.length + inc1.length + mid1.length + inc2.length,
        ),
      ).toBeNull(); // mid2

      // decompose
      const parts = sm.decompose(doc);
      expect(parts.size).toBe(3);
      expect(parts.get("f1.md")).toBe(inc1);
      expect(parts.get("f2.md")).toBe(inc2);
      expect(parts.get("f3.md")).toBe(inc3);

      // reconstructMain
      const reconstructed = sm.reconstructMain(doc, "main.md");
      expect(reconstructed).toBe(
        header + "{{f1}}" + mid1 + "{{f2}}" + mid2 + "{{f3}}" + footer,
      );
    });

    it("binary search works correctly for many regions", () => {
      // Create 10 regions: each 10 chars wide with 5 char gaps
      const regions: IncludeRegion[] = [];
      for (let i = 0; i < 10; i++) {
        const from = i * 15 + 5; // gap of 5, then 10 chars
        const to = from + 10;
        regions.push(region(from, to, `file${i}.md`));
      }
      const sm = new SourceMap(regions);

      // Check all gaps return null
      for (let i = 0; i < 10; i++) {
        const gapStart = i * 15;
        expect(sm.fileAt(gapStart)).toBeNull();
        expect(sm.fileAt(gapStart + 4)).toBeNull();
      }

      // Check all regions return correct file
      for (let i = 0; i < 10; i++) {
        const regionStart = i * 15 + 5;
        expect(sm.fileAt(regionStart)).toBe(`file${i}.md`);
        expect(sm.fileAt(regionStart + 5)).toBe(`file${i}.md`);
        expect(sm.fileAt(regionStart + 9)).toBe(`file${i}.md`);
      }
    });
  });
});
