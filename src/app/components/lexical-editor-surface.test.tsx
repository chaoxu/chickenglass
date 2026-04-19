import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LexicalEditor } from "lexical";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchFormatEvent } from "../../constants/events";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";

const { markdownEditorMock } = vi.hoisted(() => ({
  markdownEditorMock: vi.fn(),
}));

vi.mock("../../lexical/markdown-editor", () => ({
  LexicalMarkdownEditor: (props: unknown) => {
    markdownEditorMock(props);
    return createElement("div", { "data-testid": "markdown-editor" });
  },
}));

const { LexicalEditorSurface } = await import("./lexical-editor-surface");

describe("LexicalEditorSurface", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    markdownEditorMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderSurface(props: Partial<ComponentProps<typeof LexicalEditorSurface>> = {}) {
    act(() => {
      root.render(createElement(LexicalEditorSurface, {
        doc: "abcde",
        editorMode: "lexical",
        ...props,
      }));
    });
  }

  it("keeps one editor mounted in source mode", () => {
    const onSelectionChange = vi.fn();
    renderSurface({
      editorMode: "source",
      onSelectionChange,
    });

    expect(container.querySelectorAll('[data-testid="markdown-editor"]')).toHaveLength(1);
    expect(markdownEditorMock).toHaveBeenCalledTimes(1);
    expect(markdownEditorMock.mock.lastCall?.[0]).toMatchObject({
      editorMode: "source",
      onSelectionChange,
    });
  });

  it("reuses the same editor component when switching modes", () => {
    renderSurface({
      editorMode: "lexical",
    });

    renderSurface({
      editorMode: "source",
    });

    expect(container.querySelectorAll('[data-testid="markdown-editor"]')).toHaveLength(1);
    expect(markdownEditorMock).toHaveBeenCalledTimes(2);
    expect(markdownEditorMock.mock.calls[0]?.[0]).toMatchObject({
      editorMode: "lexical",
    });
    expect(markdownEditorMock.mock.calls[1]?.[0]).toMatchObject({
      editorMode: "source",
    });
  });

  it("formats through the single editor handle in source mode", () => {
    const onDocumentReady = vi.fn();
    const onEditorReady = vi.fn();
    const handle = {
      applyChanges: vi.fn(),
      focus: vi.fn(),
      flushPendingEdits: vi.fn(),
      getDoc: vi.fn(() => "abcde"),
      getSelection: vi.fn(() => ({
        anchor: 1,
        focus: 4,
        from: 1,
        to: 4,
      })),
      insertText: vi.fn(),
      setDoc: vi.fn(),
      setSelection: vi.fn(),
    } satisfies MarkdownEditorHandle;

    renderSurface({
      editorMode: "source",
      onDocumentReady,
      onEditorReady,
    });

    expect(container.querySelectorAll('[data-testid="markdown-editor"]')).toHaveLength(1);
    expect(markdownEditorMock).toHaveBeenCalledTimes(1);

    const editorProps = markdownEditorMock.mock.lastCall?.[0] as {
      onEditorReady?: (nextHandle: MarkdownEditorHandle, editor: LexicalEditor) => void;
    };
    act(() => {
      editorProps.onEditorReady?.(handle, {} as LexicalEditor);
    });

    expect(onEditorReady).toHaveBeenCalledWith(handle, expect.anything());
    expect(onDocumentReady).toHaveBeenCalledTimes(1);

    act(() => {
      dispatchFormatEvent("bold");
    });

    expect(handle.applyChanges).toHaveBeenCalledWith([{
      from: 1,
      to: 4,
      insert: "**bcd**",
    }]);
    expect(handle.setSelection).toHaveBeenCalledWith(3, 6);
    expect(handle.focus).toHaveBeenCalledTimes(1);
  });
});
