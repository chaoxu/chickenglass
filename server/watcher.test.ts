// @vitest-environment node

import { describe, expect, it } from "vitest";

import { classifyFsWatchEvent, removeKnownPathPrefix } from "./watcher.js";

describe("classifyFsWatchEvent", () => {
  it("reports deletes when a rename target no longer exists", () => {
    const type = classifyFsWatchEvent("rename", "notes/index.md", false, new Set(["notes/index.md"]));

    expect(type).toBe("delete");
  });

  it("reports adds when a rename introduces a new path", () => {
    const type = classifyFsWatchEvent("rename", "notes/new.md", true, new Set(["notes/old.md"]));

    expect(type).toBe("add");
  });

  it("keeps rename events for known existing paths as changes", () => {
    const type = classifyFsWatchEvent("rename", "notes/index.md", true, new Set(["notes/index.md"]));

    expect(type).toBe("change");
  });

  it("preserves explicit change events", () => {
    const type = classifyFsWatchEvent("change", "notes/index.md", false, new Set());

    expect(type).toBe("change");
  });

  it("removes deleted directories and their descendants from the known path set", () => {
    const knownPaths = new Set(["notes", "notes/a.md", "notes/nested/b.md", "other.md"]);

    removeKnownPathPrefix(knownPaths, "notes");

    expect(knownPaths).toEqual(new Set(["other.md"]));
  });
});
