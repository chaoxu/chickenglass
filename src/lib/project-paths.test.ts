import { describe, expect, it } from "vitest";

import {
  isDescendantProjectPath,
  isSameOrDescendantProjectPath,
  isSameProjectPath,
  normalizeProjectPath,
} from "./project-paths";

describe("project path relationships", () => {
  it("normalizes project-relative paths", () => {
    expect(normalizeProjectPath("/docs/../notes/main.md")).toBe("notes/main.md");
    expect(normalizeProjectPath("./")).toBe("");
    expect(normalizeProjectPath("docs/chapter/")).toBe("docs/chapter");
  });

  it("detects exact path matches after normalization", () => {
    expect(isSameProjectPath("docs/chapter", "docs/chapter/")).toBe(true);
    expect(isSameProjectPath("./docs/chapter", "docs/chapter")).toBe(true);
    expect(isSameProjectPath("docs/chapter", "docs/chapter-one")).toBe(false);
  });

  it("detects descendants without sibling-prefix collisions", () => {
    expect(isDescendantProjectPath("docs/chapter/intro.md", "docs/chapter")).toBe(true);
    expect(isDescendantProjectPath("docs/chapter", "docs/chapter")).toBe(false);
    expect(isDescendantProjectPath("docs/chapter-one/intro.md", "docs/chapter")).toBe(false);
  });

  it("treats the project root as parent of non-root paths only", () => {
    expect(isSameProjectPath("", ".")).toBe(true);
    expect(isDescendantProjectPath("docs/intro.md", "")).toBe(true);
    expect(isDescendantProjectPath("", "")).toBe(false);
    expect(isSameOrDescendantProjectPath("", "")).toBe(true);
  });
});

