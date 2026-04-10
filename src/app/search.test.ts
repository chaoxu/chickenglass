import { describe, expect, it } from "vitest";
import type { FileEntry } from "../lib/types";
import {
  buildSemanticSearchQuery,
  collectSearchableMarkdownPaths,
  getAppSearchMode,
} from "./search";

describe("getAppSearchMode", () => {
  it("uses semantic search in lexical mode", () => {
    expect(getAppSearchMode("lexical")).toBe("semantic");
  });

  it("uses source search in source mode", () => {
    expect(getAppSearchMode("source")).toBe("source");
  });
});

describe("buildSemanticSearchQuery", () => {
  it("treats hash-prefixed text as a label query", () => {
    expect(buildSemanticSearchQuery("#thm-main", undefined)).toEqual({ label: "thm-main" });
  });

  it("treats equation-style ids as a label query", () => {
    expect(buildSemanticSearchQuery("eq:main", "equation")).toEqual({
      type: "equation",
      label: "eq:main",
    });
  });

  it("treats ordinary text as a content query", () => {
    expect(buildSemanticSearchQuery("compactness", "definition")).toEqual({
      type: "definition",
      content: "compactness",
    });
  });
});

describe("collectSearchableMarkdownPaths", () => {
  it("returns every markdown file in the tree", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "main.md", path: "main.md", isDirectory: false },
        { name: "refs.bib", path: "refs.bib", isDirectory: false },
        {
          name: "notes",
          path: "notes",
          isDirectory: true,
          children: [
            { name: "draft.md", path: "notes/draft.md", isDirectory: false },
            { name: "diagram.png", path: "notes/diagram.png", isDirectory: false },
          ],
        },
      ],
    };

    expect(collectSearchableMarkdownPaths(tree)).toEqual([
      "main.md",
      "notes/draft.md",
    ]);
  });
});
