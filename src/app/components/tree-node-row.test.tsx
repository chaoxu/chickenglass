import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadlessTreeRowProps, MenuItem } from "../hooks/use-tree-node-row";

const {
  contextMenuMock,
  contextMenuTriggerMock,
  contextMenuContentMock,
  contextMenuItemMock,
  contextMenuSeparatorMock,
} = vi.hoisted(() => ({
  contextMenuMock: vi.fn(),
  contextMenuTriggerMock: vi.fn(),
  contextMenuContentMock: vi.fn(),
  contextMenuItemMock: vi.fn(),
  contextMenuSeparatorMock: vi.fn(),
}));

vi.mock("./ui/context-menu", () => ({
  ContextMenu: (props: { children: ReactNode }) => {
    contextMenuMock(props);
    return createElement("div", { "data-testid": "context-menu" }, props.children);
  },
  ContextMenuTrigger: (props: { children: ReactNode }) => {
    contextMenuTriggerMock(props);
    return createElement("div", { "data-testid": "context-menu-trigger" }, props.children);
  },
  ContextMenuContent: (props: { children: ReactNode }) => {
    contextMenuContentMock(props);
    return createElement("div", { "data-testid": "context-menu-content" }, props.children);
  },
  ContextMenuItem: (props: { children: ReactNode }) => {
    contextMenuItemMock(props);
    return createElement("button", null, props.children);
  },
  ContextMenuSeparator: () => {
    contextMenuSeparatorMock();
    return createElement("hr");
  },
}));

const { TreeNodeRow } = await import("./tree-node-row");

describe("TreeNodeRow memoization", () => {
  let container: HTMLDivElement;
  let root: Root;
  const icon = createElement("span", null, "icon");
  const children = createElement("span", null, "name");
  const menuItems: MenuItem[] = [{ label: "Open" }];
  const mergedRef = vi.fn();
  const onRowClick = vi.fn();
  const onContextSelection = vi.fn();
  const onRowKeyDown = vi.fn();

  beforeEach(() => {
    contextMenuMock.mockClear();
    contextMenuTriggerMock.mockClear();
    contextMenuContentMock.mockClear();
    contextMenuItemMock.mockClear();
    contextMenuSeparatorMock.mockClear();
    mergedRef.mockClear();
    onRowClick.mockClear();
    onContextSelection.mockClear();
    onRowKeyDown.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(rowProps: HeadlessTreeRowProps, isActive = false) {
    act(() => {
      root.render(createElement(TreeNodeRow, {
        rowProps,
        mergedRef,
        indent: 8,
        isActive,
        isFocused: false,
        icon,
        children,
        menuItems,
        onRowClick,
        onContextSelection,
        onRowKeyDown,
      }));
    });
  }

  it("skips rerenders when shallow row props stay the same", () => {
    const rowProps = { role: "treeitem", tabIndex: -1 };

    render(rowProps);
    render({ ...rowProps });

    expect(contextMenuMock).toHaveBeenCalledTimes(1);
  });

  it("rerenders when row state changes", () => {
    const rowProps = { role: "treeitem", tabIndex: -1 };

    render(rowProps);
    render({ ...rowProps }, true);

    expect(contextMenuMock).toHaveBeenCalledTimes(2);
  });
});
