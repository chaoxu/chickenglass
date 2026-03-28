import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../file-manager";
import {
  buildTreeIndex,
  createFileTreeHotkeys,
  flattenVisibleEntries,
  resolveFileTreeKey,
} from "./use-file-tree-controller";
import { mergeChildrenIntoTree } from "./use-app-workspace-session";
import { findDefaultDocumentPath, findDefaultDocumentPathLazy } from "../default-document-path";
import { collectMdPaths } from "../export";

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

describe("createFileTreeHotkeys", () => {
  it("focuses the first item on ArrowDown when nothing is focused", () => {
    const onSelect = vi.fn();
    const hotkeys = createFileTreeHotkeys(onSelect);
    const handler = hotkeys.focusNextItem?.handler;
    const setFocused = vi.fn();
    const updateDomFocus = vi.fn();
    const tree = {
      getState: () => ({ focusedItem: null }),
      getItems: () => [
        {
          setFocused,
          getTree: () => ({ updateDomFocus }),
          isFolder: () => true,
          getId: () => "docs",
        },
      ],
    };

    expect(handler).toBeTypeOf("function");
    if (!handler) throw new Error("focusNextItem hotkey missing");
    handler(undefined as never, tree as never);

    expect(setFocused).toHaveBeenCalledTimes(1);
    expect(updateDomFocus).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("focuses the last item on ArrowUp when nothing is focused", () => {
    const onSelect = vi.fn();
    const hotkeys = createFileTreeHotkeys(onSelect);
    const handler = hotkeys.focusPreviousItem?.handler;
    const updateDomFocus = vi.fn();
    const first = {
      setFocused: vi.fn(),
      getTree: () => ({ updateDomFocus }),
      isFolder: () => true,
      getId: () => "docs",
    };
    const last = {
      setFocused: vi.fn(),
      getTree: () => ({ updateDomFocus }),
      isFolder: () => false,
      getId: () => "index.md",
    };
    const tree = {
      getState: () => ({ focusedItem: null }),
      getItems: () => [first, last],
    };

    expect(handler).toBeTypeOf("function");
    if (!handler) throw new Error("focusPreviousItem hotkey missing");
    handler(undefined as never, tree as never);

    expect(first.setFocused).not.toHaveBeenCalled();
    expect(last.setFocused).toHaveBeenCalledTimes(1);
    expect(updateDomFocus).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("index.md");
  });

  it("does nothing on Enter when nothing is focused", () => {
    const onSelect = vi.fn();
    const hotkeys = createFileTreeHotkeys(onSelect);
    const handler = hotkeys.customActivateFocusedItem?.handler;
    const tree = {
      getState: () => ({ focusedItem: null }),
    };

    expect(handler).toBeTypeOf("function");
    if (!handler) throw new Error("customActivateFocusedItem hotkey missing");
    handler(undefined as never, tree as never);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does nothing on Space when nothing is focused", () => {
    const onSelect = vi.fn();
    const hotkeys = createFileTreeHotkeys(onSelect);
    const handler = hotkeys.customToggleFocusedFolder?.handler;
    const tree = {
      getState: () => ({ focusedItem: null }),
    };

    expect(handler).toBeTypeOf("function");
    if (!handler) throw new Error("customToggleFocusedFolder hotkey missing");
    handler(undefined as never, tree as never);

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("buildTreeIndex", () => {
  it("indexes nested directory entries (#570)", () => {
    const root: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: [
            {
              name: "deep",
              path: "docs/deep",
              isDirectory: true,
              children: [
                { name: "proof.md", path: "docs/deep/proof.md", isDirectory: false },
              ],
            },
            { name: "notes.md", path: "docs/notes.md", isDirectory: false },
          ],
        },
        { name: "index.md", path: "index.md", isDirectory: false },
      ],
    };

    const { entriesById, childrenById } = buildTreeIndex(root);

    // All entries are indexed
    expect(entriesById.has("docs")).toBe(true);
    expect(entriesById.has("docs/deep")).toBe(true);
    expect(entriesById.has("docs/deep/proof.md")).toBe(true);
    expect(entriesById.has("docs/notes.md")).toBe(true);
    expect(entriesById.has("index.md")).toBe(true);

    // Directory children are populated
    expect(childrenById.get("docs")).toEqual(["docs/deep", "docs/notes.md"]);
    expect(childrenById.get("docs/deep")).toEqual(["docs/deep/proof.md"]);

    // Files have empty children
    expect(childrenById.get("index.md")).toEqual([]);
    expect(childrenById.get("docs/deep/proof.md")).toEqual([]);
  });

  it("handles null root", () => {
    const { entriesById, childrenById } = buildTreeIndex(null);
    expect(childrenById.get("__cf-file-tree-root__")).toEqual([]);
    expect(entriesById.size).toBe(1);
  });

  it("indexes shallow tree with unloaded directory children (#575)", () => {
    const root: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "docs", path: "docs", isDirectory: true },
        { name: "index.md", path: "index.md", isDirectory: false },
      ],
    };

    const { entriesById, childrenById } = buildTreeIndex(root);

    expect(entriesById.has("docs")).toBe(true);
    expect(entriesById.get("docs")?.children).toBeUndefined();
    // Unloaded directory still reports empty children in the index
    expect(childrenById.get("docs")).toEqual([]);
    expect(childrenById.get("index.md")).toEqual([]);
  });
});

describe("mergeChildrenIntoTree", () => {
  it("merges children into a top-level directory", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "docs", path: "docs", isDirectory: true },
        { name: "index.md", path: "index.md", isDirectory: false },
      ],
    };

    const children: FileEntry[] = [
      { name: "notes.md", path: "docs/notes.md", isDirectory: false },
    ];

    const result = mergeChildrenIntoTree(tree, "docs", children);
    expect(result.children![0].children).toEqual(children);
    // Other children unchanged
    expect(result.children![1]).toBe(tree.children![1]);
  });

  it("merges children into a nested directory", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: [
            { name: "deep", path: "docs/deep", isDirectory: true },
          ],
        },
      ],
    };

    const children: FileEntry[] = [
      { name: "proof.md", path: "docs/deep/proof.md", isDirectory: false },
    ];

    const result = mergeChildrenIntoTree(tree, "docs/deep", children);
    expect(result.children![0].children![0].children).toEqual(children);
  });

  it("replaces children at the root level", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
    };

    const children: FileEntry[] = [
      { name: "readme.md", path: "readme.md", isDirectory: false },
    ];

    const result = mergeChildrenIntoTree(tree, "", children);
    expect(result.children).toEqual(children);
  });

  it("returns tree unchanged when target not found", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "index.md", path: "index.md", isDirectory: false },
      ],
    };

    const result = mergeChildrenIntoTree(tree, "nonexistent", []);
    expect(result.children).toEqual(tree.children);
  });

  it("skips merge when directory children are already loaded (#575 review)", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: [
            { name: "deep", path: "docs/deep", isDirectory: true, children: [] },
            { name: "notes.md", path: "docs/notes.md", isDirectory: false },
          ],
        },
      ],
    };

    // A stale listChildren response should NOT overwrite a fully-loaded subtree
    const staleChildren: FileEntry[] = [
      { name: "notes.md", path: "docs/notes.md", isDirectory: false },
    ];

    const result = mergeChildrenIntoTree(tree, "docs", staleChildren);
    // Tree should be unchanged — docs already has children loaded
    expect(result).toBe(tree);
  });

  it("skips merge at root when children are already loaded", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "readme.md", path: "readme.md", isDirectory: false },
      ],
    };

    const result = mergeChildrenIntoTree(tree, "", []);
    expect(result).toBe(tree);
  });
});

describe("partial-tree regression (#575)", () => {
  it("findDefaultDocumentPath finds a nested .md when none exist at root", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        {
          name: "chapters",
          path: "chapters",
          isDirectory: true,
          children: [
            { name: "intro.md", path: "chapters/intro.md", isDirectory: false },
          ],
        },
      ],
    };
    expect(findDefaultDocumentPath(tree)).toBe("chapters/intro.md");
  });

  it("findDefaultDocumentPath returns null on a shallow tree with only unloaded dirs", () => {
    // This is the scenario the two-phase load prevents: a shallow tree
    // where directories have children: undefined.
    const shallowTree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "chapters", path: "chapters", isDirectory: true },
      ],
    };
    // On a shallow tree, findDefaultDocumentPath can't see nested docs.
    expect(findDefaultDocumentPath(shallowTree)).toBeNull();
  });

  it("collectMdPaths collects nested markdown files from a full tree", () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "readme.md", path: "readme.md", isDirectory: false },
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: [
            { name: "guide.md", path: "docs/guide.md", isDirectory: false },
            {
              name: "deep",
              path: "docs/deep",
              isDirectory: true,
              children: [
                { name: "proof.md", path: "docs/deep/proof.md", isDirectory: false },
              ],
            },
          ],
        },
      ],
    };
    expect(collectMdPaths(tree)).toEqual([
      "readme.md",
      "docs/guide.md",
      "docs/deep/proof.md",
    ]);
  });

  it("collectMdPaths misses nested files when directories are unloaded", () => {
    // Verifies the scenario that the two-phase load avoids: if export
    // received a shallow tree, nested docs would be silently skipped.
    const shallowTree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "readme.md", path: "readme.md", isDirectory: false },
        { name: "docs", path: "docs", isDirectory: true },
      ],
    };
    expect(collectMdPaths(shallowTree)).toEqual(["readme.md"]);
  });
});

describe("findDefaultDocumentPathLazy (#575)", () => {
  it("finds a nested .md by lazily loading children", async () => {
    const shallowTree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "chapters", path: "chapters", isDirectory: true },
      ],
    };

    const listChildren = vi.fn(async (path: string) => {
      if (path === "chapters") {
        return [{ name: "intro.md", path: "chapters/intro.md", isDirectory: false }];
      }
      return [];
    });

    const result = await findDefaultDocumentPathLazy(shallowTree, listChildren);
    expect(result).toBe("chapters/intro.md");
    expect(listChildren).toHaveBeenCalledWith("chapters");
  });

  it("prefers root-level main.md without lazy loading", async () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "main.md", path: "main.md", isDirectory: false },
        { name: "docs", path: "docs", isDirectory: true },
      ],
    };

    const listChildren = vi.fn(async () => []);

    const result = await findDefaultDocumentPathLazy(tree, listChildren);
    expect(result).toBe("main.md");
    expect(listChildren).not.toHaveBeenCalled();
  });

  it("prefers index.md over other .md files at root", async () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "notes.md", path: "notes.md", isDirectory: false },
        { name: "index.md", path: "index.md", isDirectory: false },
      ],
    };

    const listChildren = vi.fn(async () => []);

    const result = await findDefaultDocumentPathLazy(tree, listChildren);
    expect(result).toBe("index.md");
    expect(listChildren).not.toHaveBeenCalled();
  });

  it("traverses multiple directory levels lazily", async () => {
    const shallowTree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "src", path: "src", isDirectory: true },
      ],
    };

    const listChildren = vi.fn(async (path: string) => {
      if (path === "src") {
        return [{ name: "deep", path: "src/deep", isDirectory: true }];
      }
      if (path === "src/deep") {
        return [{ name: "proof.md", path: "src/deep/proof.md", isDirectory: false }];
      }
      return [];
    });

    const result = await findDefaultDocumentPathLazy(shallowTree, listChildren);
    expect(result).toBe("src/deep/proof.md");
    expect(listChildren).toHaveBeenCalledWith("src");
    expect(listChildren).toHaveBeenCalledWith("src/deep");
  });

  it("returns null when no files exist anywhere", async () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "empty", path: "empty", isDirectory: true },
      ],
    };

    const listChildren = vi.fn(async () => []);

    const result = await findDefaultDocumentPathLazy(tree, listChildren);
    expect(result).toBeNull();
  });

  it("skips listChildren for directories with children already loaded", async () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: [
            { name: "guide.md", path: "docs/guide.md", isDirectory: false },
          ],
        },
      ],
    };

    const listChildren = vi.fn(async () => []);

    const result = await findDefaultDocumentPathLazy(tree, listChildren);
    expect(result).toBe("docs/guide.md");
    expect(listChildren).not.toHaveBeenCalled();
  });
});
