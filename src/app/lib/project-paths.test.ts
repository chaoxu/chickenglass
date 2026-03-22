import { describe, expect, it } from "vitest";

import {
  normalizeProjectPath,
  projectPathCandidatesFromDocument,
  relativeProjectPathFromDocument,
  resolveProjectPathFromDocument,
} from "./project-paths";

describe("normalizeProjectPath", () => {
  it("strips leading slashes and resolves dot segments", () => {
    expect(normalizeProjectPath("/assets/./figures/../plot.png")).toBe("assets/plot.png");
  });

  it("normalizes windows separators", () => {
    expect(normalizeProjectPath("notes\\images\\diagram.png")).toBe("notes/images/diagram.png");
  });
});

describe("resolveProjectPathFromDocument", () => {
  it("resolves relative paths from the document directory", () => {
    expect(resolveProjectPathFromDocument("notes/main.md", "assets/plot.png")).toBe(
      "notes/assets/plot.png",
    );
  });

  it("treats leading slash paths as project-root relative", () => {
    expect(resolveProjectPathFromDocument("notes/main.md", "/assets/plot.png")).toBe(
      "assets/plot.png",
    );
  });
});

describe("projectPathCandidatesFromDocument", () => {
  it("returns document-relative then project-root candidates", () => {
    expect(projectPathCandidatesFromDocument("notes/main.md", "refs/library.bib")).toEqual([
      "notes/refs/library.bib",
      "refs/library.bib",
    ]);
  });

  it("deduplicates identical root candidates", () => {
    expect(projectPathCandidatesFromDocument("main.md", "refs/library.bib")).toEqual([
      "refs/library.bib",
    ]);
  });
});

describe("relativeProjectPathFromDocument", () => {
  it("returns a document-relative markdown path for nested assets", () => {
    expect(relativeProjectPathFromDocument("notes/main.md", "notes/assets/plot.png")).toBe(
      "assets/plot.png",
    );
  });

  it("walks up to the project root when needed", () => {
    expect(relativeProjectPathFromDocument("notes/main.md", "assets/plot.png")).toBe(
      "../assets/plot.png",
    );
  });
});
