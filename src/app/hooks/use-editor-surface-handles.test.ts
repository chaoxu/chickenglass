import { act, createElement, type FC, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import { useEditorSurfaceHandles } from "./use-editor-surface-handles";

interface HarnessRef {
  result: ReturnType<typeof useEditorSurfaceHandles>;
}

function createHandle(doc = "Alpha"): MarkdownEditorHandle {
  const selection = {
    anchor: doc.length,
    focus: doc.length,
    from: doc.length,
    to: doc.length,
  };
  return {
    applyChanges: vi.fn(),
    flushPendingEdits: vi.fn(() => null),
    focus: vi.fn(),
    getDoc: vi.fn(() => doc),
    getSelection: vi.fn(() => selection),
    insertText: vi.fn(),
    peekDoc: vi.fn(() => doc),
    peekSelection: vi.fn(() => selection),
    setDoc: vi.fn(),
    setSelection: vi.fn(),
  };
}

function stubFilePicker(file: File): void {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName === "input") {
      Object.defineProperty(element, "click", {
        value: () => {
          Object.defineProperty(element, "files", { value: [file] });
          element.dispatchEvent(new Event("change"));
        },
      });
    }
    return element;
  });
}

function createHarness(options: {
  readonly currentPath: string | null;
  readonly editorHandleRef: MutableRefObject<MarkdownEditorHandle | null>;
}): { readonly Harness: FC; readonly ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as ReturnType<typeof useEditorSurfaceHandles>,
  };

  const Harness: FC = () => {
    ref.result = useEditorSurfaceHandles({
      currentPath: options.currentPath,
      editorDoc: "Alpha",
      editorHandleRef: options.editorHandleRef,
      handleCmGotoLine: vi.fn(),
      handleCmOutlineSelect: vi.fn(),
      syncView: vi.fn(),
    });
    return null;
  };

  return { Harness, ref };
}

describe("useEditorSurfaceHandles", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
  });

  it("completes same-file Lexical navigation immediately when the handle is ready", () => {
    const handle = createHandle();
    const onComplete = vi.fn();
    const { Harness, ref } = createHarness({
      currentPath: "a.md",
      editorHandleRef: { current: handle },
    });

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.queueLexicalNavigation({
        onComplete,
        path: "a.md",
        pos: 3,
        requestId: 1,
      });
    });

    expect(handle.setSelection).toHaveBeenCalledWith(3, 3);
    expect(handle.focus).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("inserts picked images through the Lexical markdown handle", async () => {
    const handle = createHandle();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", {
      type: "image/png",
    });
    stubFilePicker(file);
    const { Harness, ref } = createHarness({
      currentPath: "a.md",
      editorHandleRef: { current: handle },
    });

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.handleInsertImage();
    });

    await vi.waitFor(() => {
      expect(handle.insertText).toHaveBeenCalledOnce();
    });
    expect(handle.insertText).toHaveBeenCalledWith(expect.stringContaining("![photo]("));
    expect(handle.insertText).toHaveBeenCalledWith(expect.stringMatching(/^\n!\[photo\]\(data:image\/png;base64,/));
    expect(handle.focus).toHaveBeenCalledOnce();
  });

  it("warns instead of silently no-oping when no editor surface can insert an image", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { Harness, ref } = createHarness({
      currentPath: "a.md",
      editorHandleRef: { current: null },
    });

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.handleInsertImage();
    });

    expect(warn).toHaveBeenCalledWith(
      "[editor] Insert Image is unavailable until an editor surface is ready.",
    );
  });
});
