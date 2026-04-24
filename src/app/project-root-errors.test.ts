import { describe, expect, it } from "vitest";
import { isProjectRootEscapeError, saveAsErrorMessage } from "./project-root-errors";

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

describe("saveAsErrorMessage", () => {
  it("explains that external Save As destinations are unsupported", () => {
    expect(saveAsErrorMessage(new Error("Path '/tmp/outside.md' escapes project root"))).toBe(
      "Save As can only save inside the current project folder. Choose a location inside the open project.",
    );
  });

  it("preserves the underlying message for unrelated failures", () => {
    expect(saveAsErrorMessage(new Error("permission denied"))).toBe(
      "Save As failed: permission denied",
    );
  });
});
