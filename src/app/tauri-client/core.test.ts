import { describe, expect, it } from "vitest";

import { isNativeCommandError } from "./core";

describe("native command errors", () => {
  it("recognizes serializable Tauri command errors by stable code", () => {
    expect(isNativeCommandError({
      code: "fs.notFound",
      message: "File not found: notes.md",
    })).toBe(true);

    expect(isNativeCommandError("File not found: notes.md")).toBe(false);
    expect(isNativeCommandError({ message: "File not found: notes.md" })).toBe(false);
  });
});
