import { describe, expect, it } from "vitest";
import { isProjectRootEscapeError } from "./project-root-errors";

describe("isProjectRootEscapeError", () => {
  it("matches Tauri path errors reported as Error instances", () => {
    expect(isProjectRootEscapeError(new Error("Path '/tmp/outside.md' escapes project root"))).toBe(true);
  });

  it("matches Tauri path errors reported as plain strings", () => {
    expect(isProjectRootEscapeError("Path '/tmp/outside.md' escapes project root")).toBe(true);
  });

  it("does not hide unrelated project-root failures", () => {
    expect(isProjectRootEscapeError(new Error("No project folder open"))).toBe(false);
    expect(isProjectRootEscapeError(new Error("Cannot resolve path '/tmp/file.md': permission denied"))).toBe(false);
  });
});
