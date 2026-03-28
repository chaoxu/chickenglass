import { describe, it, expect } from "vitest";
import { computeEffectiveGitStatus } from "./file-tree";

describe("computeEffectiveGitStatus", () => {
  it("returns an empty map for empty input", () => {
    expect(computeEffectiveGitStatus({})).toEqual({});
  });

  it("preserves file-level statuses", () => {
    const input = { "a.md": "modified" as const, "b.md": "untracked" as const };
    const result = computeEffectiveGitStatus(input);
    expect(result["a.md"]).toBe("modified");
    expect(result["b.md"]).toBe("untracked");
  });

  it("propagates status to parent folders", () => {
    const result = computeEffectiveGitStatus({ "docs/note.md": "modified" });
    expect(result["docs"]).toBe("modified");
    expect(result["docs/note.md"]).toBe("modified");
  });

  it("propagates through multiple ancestor levels", () => {
    const result = computeEffectiveGitStatus({ "a/b/c.md": "added" });
    expect(result["a/b"]).toBe("added");
    expect(result["a"]).toBe("added");
  });

  it("folder inherits the worst status among descendants (modified > added > untracked)", () => {
    const result = computeEffectiveGitStatus({
      "src/a.md": "untracked",
      "src/b.md": "added",
      "src/c.md": "modified",
    });
    expect(result["src"]).toBe("modified");
  });

  it("folder with only untracked children shows untracked", () => {
    const result = computeEffectiveGitStatus({
      "dir/x.md": "untracked",
      "dir/y.md": "untracked",
    });
    expect(result["dir"]).toBe("untracked");
  });

  it("does not create entries for top-level files with no parent", () => {
    const result = computeEffectiveGitStatus({ "root.md": "modified" });
    expect(Object.keys(result)).toEqual(["root.md"]);
  });
});
