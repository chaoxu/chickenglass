import { describe, expect, it } from "vitest";

import type { DocumentIndex, FileIndex, IndexEntry, IndexReference } from "./query-api";
import { findReferences, getAllLabels, queryIndex, querySourceText, resolveLabel } from "./query-api";

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

function makeIndex(
  fileIndices: Array<Omit<FileIndex, "sourceText"> & Partial<Pick<FileIndex, "sourceText">>>,
): DocumentIndex {
  const files = new Map<string, FileIndex>();
  for (const fi of fileIndices) {
    files.set(fi.file, {
      sourceText: fi.sourceText ?? "",
      ...fi,
    });
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

describe("querySourceText", () => {
  const index = makeIndex([
    {
      file: "chapter1.md",
      sourceText: [
        "# Heading",
        "RAW_TOKEN_785 appears here.",
        "raw_token_785 appears again.",
      ].join("\n"),
      entries: [],
      references: [],
    },
    {
      file: "chapter2.md",
      sourceText: "No raw marker here.",
      entries: [],
      references: [],
    },
  ]);

  it("finds case-insensitive raw-text matches with source positions", () => {
    const results = querySourceText(index, { text: "raw_token_785" });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      type: "text",
      file: "chapter1.md",
      number: "2",
      content: "RAW_TOKEN_785 appears here.",
    });
    expect(results[0].position.from).toBeGreaterThan(0);
    expect(results[0].position.to).toBeGreaterThan(results[0].position.from);
    expect(results[1].number).toBe("3");
  });

  it("respects the file filter", () => {
    const results = querySourceText(index, { text: "raw_token_785", file: "chapter2.md" });
    expect(results).toHaveLength(0);
  });

  it("returns no results for empty text", () => {
    expect(querySourceText(index, { text: "   " })).toEqual([]);
  });
});

describe("getAllLabels", () => {
  const index = makeIndex([
    {
      file: "chapter1.md",
      entries: [
        makeEntry({ type: "theorem", label: "thm-1", file: "chapter1.md" }),
        makeEntry({ type: "proof", file: "chapter1.md" }),
        makeEntry({ type: "equation", label: "eq:1", file: "chapter1.md" }),
      ],
      references: [],
    },
    {
      file: "chapter2.md",
      entries: [
        makeEntry({ type: "heading", label: "sec:appendix", file: "chapter2.md" }),
      ],
      references: [],
    },
  ]);

  it("returns labels in file and entry order, skipping unlabeled entries", () => {
    expect(getAllLabels(index)).toEqual(["thm-1", "eq:1", "sec:appendix"]);
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
    expect(entry.kind).toBe("resolved");
    expect(entry.kind === "resolved" ? entry.entry.type : undefined).toBe("theorem");
    expect(entry.kind === "resolved" ? entry.entry.file : undefined).toBe("main.md");
  });

  it("resolves labels across files", () => {
    const entry = resolveLabel(index, "thm-appendix");
    expect(entry.kind).toBe("resolved");
    expect(entry.kind === "resolved" ? entry.entry.file : undefined).toBe("appendix.md");
  });

  it("returns undefined for unknown labels", () => {
    const entry = resolveLabel(index, "nonexistent");
    expect(entry).toEqual({ kind: "missing" });
  });

  it("surfaces duplicate labels as ambiguous", () => {
    const duplicateIndex = makeIndex([
      {
        file: "main.md",
        entries: [makeEntry({ type: "theorem", label: "thm-shared", file: "main.md" })],
        references: [],
      },
      {
        file: "appendix.md",
        entries: [makeEntry({ type: "lemma", label: "thm-shared", file: "appendix.md" })],
        references: [],
      },
    ]);

    const entry = resolveLabel(duplicateIndex, "thm-shared");
    expect(entry.kind).toBe("ambiguous");
    expect(entry.kind === "ambiguous" ? entry.entries.map((candidate) => candidate.file) : []).toEqual([
      "main.md",
      "appendix.md",
    ]);
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
    expect(refs[0].ambiguousTargets).toBeUndefined();
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

  it("returns explicit ambiguous targets instead of picking one definition", () => {
    const duplicateIndex = makeIndex([
      {
        file: "a.md",
        entries: [makeEntry({ type: "theorem", label: "thm-1", file: "a.md" })],
        references: [],
      },
      {
        file: "b.md",
        entries: [makeEntry({ type: "lemma", label: "thm-1", file: "b.md" })],
        references: [makeRef({ ids: ["thm-1"], sourceFile: "b.md" })],
      },
    ]);

    const refs = findReferences(duplicateIndex, "thm-1");
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBeUndefined();
    expect(refs[0].ambiguousTargets?.map((entry) => entry.file)).toEqual(["a.md", "b.md"]);
  });
});
