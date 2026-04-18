import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import { createElement, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { FileSystemProvider } from "../../app/contexts/file-system-context";
import { MemoryFileSystem } from "../../app/file-manager";
import type { MarkdownEditorHandle } from "../markdown-editor-types";
import { LexicalRichMarkdownEditor } from "../rich-markdown-editor";

type RichMarkdownEditorProps = ComponentProps<typeof LexicalRichMarkdownEditor>;

const INLINE_IMAGE_DOC = "Before ![Inline alt](image.png) after";

async function mountEditor(overrides: Partial<RichMarkdownEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  let handle: MarkdownEditorHandle | null = null;
  let currentProps: RichMarkdownEditorProps = {
    doc: INLINE_IMAGE_DOC,
    onEditorReady: (nextHandle, nextEditor) => {
      handle = nextHandle;
      editor = nextEditor;
    },
    preserveLocalHistory: true,
    testId: null,
    ...overrides,
  };
  const fs = new MemoryFileSystem();
  const view = render(
    createElement(
      FileSystemProvider,
      { value: fs },
      createElement(LexicalRichMarkdownEditor, currentProps),
    ),
  );

  await waitFor(() => expect(editor).not.toBeNull());
  await waitFor(() => expect(handle).not.toBeNull());

  return {
    get editor(): LexicalEditor {
      if (!editor) {
        throw new Error("expected editor to be ready");
      }
      return editor;
    },
    get handle(): MarkdownEditorHandle {
      if (!handle) {
        throw new Error("expected editor handle to be ready");
      }
      return handle;
    },
    rerender(nextOverrides: Partial<RichMarkdownEditorProps> = {}) {
      currentProps = {
        ...currentProps,
        ...nextOverrides,
      };
      view.rerender(
        createElement(
          FileSystemProvider,
          { value: fs },
          createElement(LexicalRichMarkdownEditor, currentProps),
        ),
      );
    },
    unmount() {
      view.unmount();
    },
  };
}

function queryInlineImageSource(editor: LexicalEditor): HTMLInputElement | null {
  return editor.getRootElement()?.querySelector<HTMLInputElement>(
    ".cf-lexical-inline-token-source",
  ) ?? null;
}

async function waitForInlineImage(editor: LexicalEditor): Promise<HTMLElement> {
  await waitFor(() => {
    expect(editor.getRootElement()?.querySelector("img[alt='Inline alt']")).not.toBeNull();
  });

  const image = editor.getRootElement()?.querySelector("img[alt='Inline alt']");
  if (!(image instanceof HTMLElement)) {
    throw new Error("expected inline image to render");
  }
  return image;
}

describe("InlineImageRenderer editability", () => {
  it("does not open source editing from a read-only surface", async () => {
    const editor = await mountEditor({ editable: false });

    try {
      const image = await waitForInlineImage(editor.editor);

      act(() => {
        fireEvent.click(image);
      });

      expect(queryInlineImageSource(editor.editor)).toBeNull();
      expect(image.closest(".cf-lexical-inline-image-shell")?.getAttribute("role")).toBeNull();
      expect(editor.handle.getDoc()).toBe(INLINE_IMAGE_DOC);
    } finally {
      editor.unmount();
    }
  });

  it("closes an active source edit without committing when the surface becomes read-only", async () => {
    const editor = await mountEditor({ editable: true });

    try {
      const image = await waitForInlineImage(editor.editor);
      act(() => {
        fireEvent.click(image);
      });

      await waitFor(() => {
        expect(queryInlineImageSource(editor.editor)).not.toBeNull();
      });

      const source = queryInlineImageSource(editor.editor);
      if (!source) {
        throw new Error("expected inline image source input");
      }

      act(() => {
        fireEvent.change(source, {
          target: { value: "![Changed alt](changed.png)" },
        });
      });

      act(() => {
        editor.rerender({ editable: false });
      });

      await waitFor(() => {
        expect(queryInlineImageSource(editor.editor)).toBeNull();
      });
      expect(editor.handle.getDoc()).toBe(INLINE_IMAGE_DOC);
    } finally {
      editor.unmount();
    }
  });
});
