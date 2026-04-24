import { describe, expect, it } from "vitest";

import {
  markdownReferencePathCandidatesFromDocument,
  normalizeMarkdownReferencePath,
  relativeMarkdownReferencePathFromDocument,
  resolveMarkdownReferencePathFromDocument,
} from "./markdown-reference-paths";

describe("normalizeMarkdownReferencePath", () => {
  it("strips leading slashes and resolves dot segments", () => {
    expect(normalizeMarkdownReferencePath("/assets/./figures/../plot.png")).toBe(
      "assets/plot.png",
    );
  });

  it("normalizes windows separators in markdown-authored paths", () => {
    expect(normalizeMarkdownReferencePath("notes\\images\\diagram.png")).toBe(
      "notes/images/diagram.png",
    );
  });
});

describe("resolveMarkdownReferencePathFromDocument", () => {
  it("resolves image and media paths from the document directory", () => {
    expect(resolveMarkdownReferencePathFromDocument("notes/main.md", "assets/plot.png")).toBe(
      "notes/assets/plot.png",
    );
  });

  it("treats leading slash paths as project-root relative markdown references", () => {
    expect(resolveMarkdownReferencePathFromDocument("notes/main.md", "/assets/plot.png")).toBe(
      "assets/plot.png",
    );
  });
});

describe("markdownReferencePathCandidatesFromDocument", () => {
  it("returns document-relative then project-root candidates for bibliography paths", () => {
    expect(markdownReferencePathCandidatesFromDocument("notes/main.md", "refs/library.bib"))
      .toEqual([
        "notes/refs/library.bib",
        "refs/library.bib",
      ]);
  });

  it("deduplicates identical root candidates", () => {
    expect(markdownReferencePathCandidatesFromDocument("main.md", "refs/library.bib")).toEqual([
      "refs/library.bib",
    ]);
  });
});

describe("relativeMarkdownReferencePathFromDocument", () => {
  it("returns a document-relative markdown path for nested assets", () => {
    expect(relativeMarkdownReferencePathFromDocument("notes/main.md", "notes/assets/plot.png"))
      .toBe("assets/plot.png");
  });

  it("walks up to the project root when needed", () => {
    expect(relativeMarkdownReferencePathFromDocument("notes/main.md", "assets/plot.png")).toBe(
      "../assets/plot.png",
    );
  });
});
