import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findDefaultDocumentPath } from "../default-document-path";
import { collectMdPaths } from "../export";
import type { FileEntry } from "../file-manager";
import { mergeChildrenIntoTree } from "./use-app-workspace-session";
import {
  buildTreeIndex,
  createFileTreeHotkeys,
  useFileTreeController,
} from "./use-file-tree-controller";

function requireController(
  controller: ReturnType<typeof useFileTreeController> | null,
  message: string,
) {
  if (!controller) throw new Error(message);
  return controller;
}

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

describe("useFileTreeController", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps hotkeys stable while dispatching to the latest onSelect", () => {
    const initialSelect = vi.fn();
    const latestSelect = vi.fn();
    const treeRoot: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "index.md", path: "index.md", isDirectory: false },
      ],
    };
    let controller: ReturnType<typeof useFileTreeController> | null = null;

    const Harness: FC<{ onSelect: (path: string) => void }> = ({ onSelect }) => {
      controller = useFileTreeController({ root: treeRoot, onSelect });
      return null;
    };

    act(() => root.render(createElement(Harness, { onSelect: initialSelect })));

    const firstController = requireController(
      controller,
      "controller missing after first render",
    );

    const firstHotkeys = firstController.tree.getConfig().hotkeys;
    act(() => {
      firstController.tree.getItems()[0]?.setFocused();
    });

    act(() => root.render(createElement(Harness, { onSelect: latestSelect })));

    const latestController = requireController(
      controller,
      "controller missing after rerender",
    );

    const hotkeys = latestController.tree.getConfig().hotkeys;
    const handler = hotkeys?.customActivateFocusedItem?.handler;

    expect(hotkeys).toBe(firstHotkeys);
    expect(handler).toBeTypeOf("function");
    if (!handler) throw new Error("customActivateFocusedItem hotkey missing");

    handler(undefined as never, latestController.tree as never);

    expect(initialSelect).not.toHaveBeenCalled();
    expect(latestSelect).toHaveBeenCalledWith("index.md");
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
    const resultChildren = result.children;
    const treeChildren = tree.children;
    expect(resultChildren?.[0]?.children).toEqual(children);
    // Other children unchanged
    expect(resultChildren?.[1]).toBe(treeChildren?.[1]);
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
    expect(result.children?.[0]?.children?.[0]?.children).toEqual(children);
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
  it("findDefaultDocumentPath finds a nested .md when none exist at root", async () => {
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
    expect(await findDefaultDocumentPath(tree)).toBe("chapters/intro.md");
  });

  it("findDefaultDocumentPath returns null on a shallow tree with only unloaded dirs", async () => {
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
    expect(await findDefaultDocumentPath(shallowTree)).toBeNull();
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

describe("findDefaultDocumentPath with lazy listChildren (#575)", () => {
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

    const result = await findDefaultDocumentPath(shallowTree, listChildren);
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

    const result = await findDefaultDocumentPath(tree, listChildren);
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

    const result = await findDefaultDocumentPath(tree, listChildren);
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

    const result = await findDefaultDocumentPath(shallowTree, listChildren);
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

    const result = await findDefaultDocumentPath(tree, listChildren);
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

    const result = await findDefaultDocumentPath(tree, listChildren);
    expect(result).toBe("docs/guide.md");
    expect(listChildren).not.toHaveBeenCalled();
  });
});
