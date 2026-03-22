import { describe, expect, it } from "vitest";

import type { DocumentIndex, FileIndex, IndexEntry, IndexReference } from "./query-api";
import { queryIndex, resolveLabel, findReferences } from "./query-api";

function makeEntry(overrides: Partial<IndexEntry> & { type: string; file: string }): IndexEntry {
  return {
    content: "",
    position: { from: 0, to: 0 },
    ...overrides,
  };
}

function makeRef(overrides: Partial<IndexReference> & { ids: readonly string[]; sourceFile: string }): IndexReference {
  return {
    bracketed: true,
    locators: overrides.ids.map(() => undefined),
    position: { from: 0, to: 0 },
    ...overrides,
  };
}

function makeIndex(fileIndices: FileIndex[]): DocumentIndex {
  const files = new Map<string, FileIndex>();
  for (const fi of fileIndices) {
    files.set(fi.file, fi);
  }
  return { files };
}

describe("queryIndex", () => {
  const index = makeIndex([
    {
      file: "chapter1.md",
      entries: [
        makeEntry({ type: "theorem", label: "thm-1", title: "Main Theorem", file: "chapter1.md", content: "Let x be a number" }),
        makeEntry({ type: "definition", label: "def-1", file: "chapter1.md", content: "A group is a set" }),
        makeEntry({ type: "equation", label: "eq:euler", file: "chapter1.md", content: "e^{i\\pi} + 1 = 0" }),
      ],
      references: [],
    },
    {
      file: "chapter2.md",
      entries: [
        makeEntry({ type: "theorem", label: "thm-2", file: "chapter2.md", content: "Every group has an identity" }),
        makeEntry({ type: "proof", file: "chapter2.md", content: "By definition of group" }),
      ],
      references: [],
    },
  ]);

  it("returns all entries when query is empty", () => {
    const results = queryIndex(index, {});
    expect(results).toHaveLength(5);
  });

  it("filters by type", () => {
    const results = queryIndex(index, { type: "theorem" });
    expect(results).toHaveLength(2);
    expect(results[0].label).toBe("thm-1");
    expect(results[1].label).toBe("thm-2");
  });

  it("filters by label", () => {
    const results = queryIndex(index, { label: "eq:euler" });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("equation");
  });

  it("filters by content (case-insensitive)", () => {
    const results = queryIndex(index, { content: "group" });
    expect(results).toHaveLength(3);
  });

  it("filters by file", () => {
    const results = queryIndex(index, { file: "chapter2.md" });
    expect(results).toHaveLength(2);
  });

  it("combines multiple filters with AND", () => {
    const results = queryIndex(index, { type: "theorem", file: "chapter1.md" });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("thm-1");
  });

  it("returns empty when no entries match", () => {
    const results = queryIndex(index, { type: "lemma" });
    expect(results).toHaveLength(0);
  });
});

describe("resolveLabel", () => {
  const index = makeIndex([
    {
      file: "main.md",
      entries: [
        makeEntry({ type: "theorem", label: "thm-main", file: "main.md" }),
        makeEntry({ type: "equation", label: "eq:1", file: "main.md" }),
      ],
      references: [],
    },
    {
      file: "appendix.md",
      entries: [
        makeEntry({ type: "theorem", label: "thm-appendix", file: "appendix.md" }),
      ],
      references: [],
    },
  ]);

  it("resolves a label to its entry", () => {
    const entry = resolveLabel(index, "thm-main");
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("theorem");
    expect(entry?.file).toBe("main.md");
  });

  it("resolves labels across files", () => {
    const entry = resolveLabel(index, "thm-appendix");
    expect(entry).toBeDefined();
    expect(entry?.file).toBe("appendix.md");
  });

  it("returns undefined for unknown labels", () => {
    const entry = resolveLabel(index, "nonexistent");
    expect(entry).toBeUndefined();
  });
});

describe("findReferences", () => {
  const thmEntry = makeEntry({ type: "theorem", label: "thm-1", file: "chapter1.md" });
  const index = makeIndex([
    {
      file: "chapter1.md",
      entries: [thmEntry],
      references: [
        makeRef({ ids: ["thm-1"], sourceFile: "chapter1.md", position: { from: 100, to: 108 } }),
      ],
    },
    {
      file: "chapter2.md",
      entries: [],
      references: [
        makeRef({ ids: ["thm-1"], sourceFile: "chapter2.md", position: { from: 50, to: 58 } }),
        makeRef({ ids: ["thm-2"], sourceFile: "chapter2.md", position: { from: 200, to: 208 } }),
      ],
    },
  ]);

  it("finds all references to a label", () => {
    const refs = findReferences(index, "thm-1");
    expect(refs).toHaveLength(2);
    expect(refs[0].reference.sourceFile).toBe("chapter1.md");
    expect(refs[1].reference.sourceFile).toBe("chapter2.md");
  });

  it("includes resolved target", () => {
    const refs = findReferences(index, "thm-1");
    expect(refs[0].target).toBeDefined();
    expect(refs[0].target?.label).toBe("thm-1");
  });

  it("returns empty for unreferenced labels", () => {
    const refs = findReferences(index, "unused-label");
    expect(refs).toHaveLength(0);
  });

  it("returns undefined target for unresolved references", () => {
    const refs = findReferences(index, "thm-2");
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBeUndefined();
  });

  it("finds references within multi-id clusters", () => {
    const multiRefIndex = makeIndex([
      {
        file: "doc.md",
        entries: [thmEntry],
        references: [
          makeRef({ ids: ["thm-1", "thm-2"], sourceFile: "doc.md" }),
        ],
      },
    ]);
    const refs = findReferences(multiRefIndex, "thm-1");
    expect(refs).toHaveLength(1);
    expect(refs[0].reference.ids).toEqual(["thm-1", "thm-2"]);
  });
});
