import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../file-manager";
import {
  createFileTreeHotkeys,
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
