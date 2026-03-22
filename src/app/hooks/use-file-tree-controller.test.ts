import { describe, expect, it } from "vitest";
import type { FileEntry } from "../file-manager";
import {
  flattenVisibleEntries,
  resolveFileTreeKey,
} from "./use-file-tree-controller";

function file(
  path: string,
  children?: FileEntry[],
): FileEntry {
  return {
    name: path.split("/").pop() ?? path,
    path,
    isDirectory: Boolean(children),
    children,
  };
}

describe("flattenVisibleEntries", () => {
  it("includes only open directory descendants", () => {
    const notes = file("docs/notes.md");
    const deepProof = file("docs/deep/proof.md");
    const deepDir = file("docs/deep", [deepProof]);
    const docsDir = file("docs", [notes, deepDir]);
    const indexFile = file("index.md");
    const entries = [
      docsDir,
      indexFile,
    ];

    expect(flattenVisibleEntries(entries, new Set())).toEqual([
      docsDir,
      indexFile,
    ]);

    expect(flattenVisibleEntries(entries, new Set(["docs"]))).toEqual([
      docsDir,
      notes,
      deepDir,
      indexFile,
    ]);
  });
});

describe("resolveFileTreeKey", () => {
  const visibleEntries = [
    file("docs", [file("docs/a.md")]),
    file("docs/a.md"),
    file("index.md"),
  ];

  it("selects the first visible row on ArrowDown when nothing is selected", () => {
    expect(resolveFileTreeKey("ArrowDown", visibleEntries, null, new Set())).toEqual({
      handled: true,
      nextSelectedPath: "docs",
      activatePath: undefined,
    });
  });

  it("selects the last visible row on ArrowUp when nothing is selected", () => {
    expect(resolveFileTreeKey("ArrowUp", visibleEntries, null, new Set())).toEqual({
      handled: true,
      nextSelectedPath: "index.md",
      activatePath: "index.md",
    });
  });

  it("activates files when moving onto them", () => {
    expect(resolveFileTreeKey("ArrowDown", visibleEntries, "docs", new Set())).toEqual({
      handled: true,
      nextSelectedPath: "docs/a.md",
      activatePath: "docs/a.md",
    });
  });

  it("toggles folders on Enter", () => {
    expect(resolveFileTreeKey("Enter", visibleEntries, "docs", new Set())).toEqual({
      handled: true,
      toggleFolderPath: "docs",
    });
  });

  it("opens closed folders on ArrowRight", () => {
    expect(resolveFileTreeKey("ArrowRight", visibleEntries, "docs", new Set())).toEqual({
      handled: true,
      setFolderOpen: {
        path: "docs",
        open: true,
      },
    });
  });

  it("closes open folders on ArrowLeft", () => {
    expect(resolveFileTreeKey("ArrowLeft", visibleEntries, "docs", new Set(["docs"]))).toEqual({
      handled: true,
      setFolderOpen: {
        path: "docs",
        open: false,
      },
    });
  });
});
