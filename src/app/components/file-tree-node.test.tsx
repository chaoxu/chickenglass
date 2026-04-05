import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ItemInstance } from "@headless-tree/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../file-manager";
import type { HeadlessTreeRowProps } from "../hooks/use-tree-node-row";

const { fileNodeMock, folderNodeMock } = vi.hoisted(() => ({
  fileNodeMock: vi.fn(),
  folderNodeMock: vi.fn(),
}));

vi.mock("./file-tree-node-file", () => ({
  FileTreeNodeFile: (props: unknown) => {
    fileNodeMock(props);
    return createElement("div", { "data-testid": "file-node" });
  },
}));

vi.mock("./file-tree-node-folder", () => ({
  FileTreeNodeFolder: (props: unknown) => {
    folderNodeMock(props);
    return createElement("div", { "data-testid": "folder-node" });
  },
}));

const { FileTreeNode } = await import("./file-tree-node");

interface RenderFileTreeNodeProps {
  readonly item: ItemInstance<FileEntry>;
  readonly entry: FileEntry;
  readonly depth: number;
  readonly isActive: boolean;
  readonly isFocused: boolean;
  readonly isExpanded: boolean;
  readonly rowProps: HeadlessTreeRowProps;
}

describe("FileTreeNode memoization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    fileNodeMock.mockClear();
    folderNodeMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: RenderFileTreeNodeProps) {
    act(() => {
      root.render(createElement(FileTreeNode, props));
    });
  }

  it("skips file rerenders when snapshot props are unchanged", () => {
    const item = {} as ItemInstance<FileEntry>;
    const entry: FileEntry = { name: "notes.md", path: "notes.md", isDirectory: false };

    render({
      item,
      entry,
      depth: 0,
      isActive: false,
      isFocused: false,
      isExpanded: false,
      rowProps: { role: "treeitem", tabIndex: -1 },
    });

    render({
      item,
      entry: { ...entry },
      depth: 0,
      isActive: false,
      isFocused: false,
      isExpanded: false,
      rowProps: { role: "treeitem", tabIndex: -1 },
    });

    expect(fileNodeMock).toHaveBeenCalledTimes(1);

    render({
      item,
      entry: { ...entry },
      depth: 0,
      isActive: true,
      isFocused: false,
      isExpanded: false,
      rowProps: { role: "treeitem", tabIndex: -1 },
    });

    expect(fileNodeMock).toHaveBeenCalledTimes(2);
  });

  it("rerenders folders when expansion state changes", () => {
    const item = {} as ItemInstance<FileEntry>;
    const entry: FileEntry = { name: "docs", path: "docs", isDirectory: true };

    render({
      item,
      entry,
      depth: 0,
      isActive: false,
      isFocused: false,
      isExpanded: false,
      rowProps: { role: "treeitem", tabIndex: -1, "aria-expanded": false },
    });

    render({
      item,
      entry: { ...entry },
      depth: 0,
      isActive: false,
      isFocused: false,
      isExpanded: false,
      rowProps: { role: "treeitem", tabIndex: -1, "aria-expanded": false },
    });

    expect(folderNodeMock).toHaveBeenCalledTimes(1);

    render({
      item,
      entry: { ...entry },
      depth: 0,
      isActive: false,
      isFocused: false,
      isExpanded: true,
      rowProps: { role: "treeitem", tabIndex: -1, "aria-expanded": true },
    });

    expect(folderNodeMock).toHaveBeenCalledTimes(2);
  });
});
