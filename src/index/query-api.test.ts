import { describe, expect, it } from "vitest";

import type { DocumentIndex, FileIndex, IndexEntry, IndexReference } from "./query-api";
import {
  findReferences,
  getAllLabels,
  queryIndex,
  querySourceText,
  resolveLabel,
  resolveLabelResolution,
  resolveLabelTargets,
} from "./query-api";

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

  it("stops after the requested result limit", () => {
    const results = queryIndex(index, { content: "group", limit: 2 });
    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.file)).toEqual([
      "chapter1.md",
      "chapter2.md",
    ]);
  });

  it("refreshes cached document lookups when the index revision changes", () => {
    const first = makeEntry({ type: "theorem", label: "first", file: "main.md" });
    const second = makeEntry({ type: "theorem", label: "second", file: "main.md" });
    const files = new Map<string, FileIndex>([
      [
        "main.md",
        {
          file: "main.md",
          sourceText: "",
          entries: [first],
          references: [],
        },
      ],
    ]);
    const index = { revision: 1, files } satisfies DocumentIndex;

    expect(queryIndex(index, { label: "first" })).toEqual([first]);

    files.set("main.md", {
      file: "main.md",
      sourceText: "",
      entries: [second],
      references: [],
    });
    index.revision = 2;

    expect(queryIndex(index, { label: "second" })).toEqual([second]);
    expect(queryIndex(index, { label: "first" })).toEqual([]);
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

  it("stops raw source search after the requested result limit", () => {
    const results = querySourceText(index, { text: "raw_token_785", limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe("2");
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

  it("returns undefined instead of choosing an arbitrary duplicate label", () => {
    const duplicateIndex = makeIndex([
      {
        file: "z-late.md",
        entries: [
          makeEntry({ type: "theorem", label: "dup", file: "z-late.md", position: { from: 20, to: 30 } }),
        ],
        references: [],
      },
      {
        file: "a-early.md",
        entries: [
          makeEntry({ type: "definition", label: "dup", file: "a-early.md", position: { from: 5, to: 10 } }),
        ],
        references: [],
      },
    ]);

    expect(resolveLabel(duplicateIndex, "dup")).toBeUndefined();
  });
});

describe("resolveLabelResolution", () => {
  it("reports missing, unique, and ambiguous labels explicitly", () => {
    const first = makeEntry({ type: "definition", label: "dup", file: "b.md", position: { from: 20, to: 30 } });
    const second = makeEntry({ type: "theorem", label: "dup", file: "a.md", position: { from: 10, to: 15 } });
    const unique = makeEntry({ type: "lemma", label: "only", file: "c.md" });
    const index = makeIndex([
      { file: "b.md", entries: [first], references: [] },
      { file: "a.md", entries: [second], references: [] },
      { file: "c.md", entries: [unique], references: [] },
    ]);

    expect(resolveLabelResolution(index, "missing")).toEqual({
      kind: "missing",
      targets: [],
    });
    expect(resolveLabelResolution(index, "only")).toEqual({
      kind: "unique",
      target: unique,
      targets: [unique],
    });
    expect(resolveLabelResolution(index, "dup")).toEqual({
      kind: "ambiguous",
      targets: [second, first],
    });
  });

  it("sorts duplicate targets stably independent of file insertion order", () => {
    const late = makeEntry({ type: "theorem", label: "dup", file: "z.md", position: { from: 2, to: 3 } });
    const early = makeEntry({ type: "theorem", label: "dup", file: "a.md", position: { from: 20, to: 30 } });
    const earlierInSameFile = makeEntry({ type: "lemma", label: "dup", file: "a.md", position: { from: 1, to: 5 } });
    const indexA = makeIndex([
      { file: "z.md", entries: [late], references: [] },
      { file: "a.md", entries: [early, earlierInSameFile], references: [] },
    ]);
    const indexB = makeIndex([
      { file: "a.md", entries: [early, earlierInSameFile], references: [] },
      { file: "z.md", entries: [late], references: [] },
    ]);

    const expected = [
      earlierInSameFile,
      early,
      late,
    ];

    expect(resolveLabelTargets(indexA, "dup")).toEqual(expected);
    expect(resolveLabelTargets(indexB, "dup")).toEqual(expected);
    expect(resolveLabelResolution(indexA, "dup")).toEqual(resolveLabelResolution(indexB, "dup"));
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
    expect(refs[0].label).toBe("thm-1");
    expect(refs[0].reference.sourceFile).toBe("chapter1.md");
    expect(refs[1].reference.sourceFile).toBe("chapter2.md");
  });

  it("includes resolved target", () => {
    const refs = findReferences(index, "thm-1");
    expect(refs[0].target).toBeDefined();
    expect(refs[0].target?.label).toBe("thm-1");
    expect(refs[0].resolution.kind).toBe("unique");
    expect(refs[0].targets).toEqual([thmEntry]);
  });

  it("returns empty for unreferenced labels", () => {
    const refs = findReferences(index, "unused-label");
    expect(refs).toHaveLength(0);
  });

  it("returns undefined target for unresolved references", () => {
    const refs = findReferences(index, "thm-2");
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBeUndefined();
    expect(refs[0].label).toBe("thm-2");
    expect(refs[0].resolution).toEqual({
      kind: "missing",
      targets: [],
    });
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

  it("preserves ambiguous targets instead of selecting one for references", () => {
    const late = makeEntry({ type: "theorem", label: "dup", file: "z.md", position: { from: 2, to: 3 } });
    const early = makeEntry({ type: "definition", label: "dup", file: "a.md", position: { from: 1, to: 5 } });
    const duplicateIndex = makeIndex([
      {
        file: "z.md",
        entries: [late],
        references: [],
      },
      {
        file: "refs.md",
        entries: [],
        references: [
          makeRef({ ids: ["dup"], sourceFile: "refs.md" }),
        ],
      },
      {
        file: "a.md",
        entries: [early],
        references: [],
      },
    ]);

    const refs = findReferences(duplicateIndex, "dup");

    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBeUndefined();
    expect(refs[0].resolution).toEqual({
      kind: "ambiguous",
      targets: [early, late],
    });
    expect(refs[0].targets).toEqual([early, late]);
  });
});
