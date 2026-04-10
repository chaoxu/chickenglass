import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MarkdownEditorHandle } from "../../lexical/plain-text-editor";
import { useEditorNavigation } from "./use-editor-navigation";

function createHandle() {
  return {
    applyChanges: vi.fn(),
    focus: vi.fn(),
    getSelection: vi.fn(() => ({ anchor: 0, focus: 0, from: 0, to: 0 })),
    insertText: vi.fn(),
    setSelection: vi.fn(),
  } satisfies MarkdownEditorHandle;
}

describe("useEditorNavigation", () => {
  it("moves the current handle for outline selection", () => {
    const handle = createHandle();
    const { result } = renderHook(() => useEditorNavigation({
      openFile: vi.fn(async () => {}),
      isPathOpen: () => true,
      currentPath: "notes.md",
      getCurrentDocText: () => "# Intro\n",
    }));

    act(() => {
      result.current.syncHandle(handle);
      result.current.handleOutlineSelect(7);
    });

    expect(handle.setSelection).toHaveBeenCalledWith(7);
    expect(handle.focus).toHaveBeenCalledTimes(1);
  });

  it("computes go-to-line offsets from raw text", () => {
    const handle = createHandle();
    const { result } = renderHook(() => useEditorNavigation({
      openFile: vi.fn(async () => {}),
      isPathOpen: () => true,
      currentPath: "notes.md",
      getCurrentDocText: () => "alpha\nbeta\ngamma\n",
    }));

    act(() => {
      result.current.syncHandle(handle);
      result.current.handleGotoLine(2, 3);
    });

    expect(handle.setSelection).toHaveBeenCalledWith(8);
  });

  it("waits for the requested file to become ready before selecting a search result", async () => {
    const handle = createHandle();
    let currentPath = "a.md";
    const openFile = vi.fn(async (path: string) => {
      currentPath = path;
    });

    const { result, rerender } = renderHook(() => useEditorNavigation({
      openFile,
      isPathOpen: (path: string) => path === currentPath,
      currentPath,
      getCurrentDocText: () => "# B\n",
    }));

    act(() => {
      result.current.syncHandle(handle);
    });

    const navigation = result.current.handleSearchResult("b.md", 4);

    act(() => {
      rerender();
      result.current.handleEditorDocumentReady("b.md");
    });

    await expect(navigation).resolves.toBe(true);
    expect(handle.setSelection).toHaveBeenCalledWith(4);
    expect(openFile).toHaveBeenCalledWith("b.md");
  });
});
