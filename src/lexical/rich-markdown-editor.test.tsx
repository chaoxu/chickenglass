import { act, render, waitFor } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import { UNDO_COMMAND } from "lexical";
import { createElement, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { FileSystemProvider } from "../app/contexts/file-system-context";
import { MemoryFileSystem } from "../app/file-manager";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";

type RichMarkdownEditorProps = ComponentProps<typeof LexicalRichMarkdownEditor>;

async function mountEditor(overrides: Partial<RichMarkdownEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  let handle: MarkdownEditorHandle | null = null;
  let currentProps: RichMarkdownEditorProps = {
    doc: "seed",
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

describe("LexicalRichMarkdownEditor nested history", () => {
  it("preserves undo history across editable blur/focus toggles", async () => {
    const editor = await mountEditor();

    try {
      act(() => {
        editor.handle.setDoc("draft one");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.rerender({ doc: "draft one" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.handle.setDoc("draft two ");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two "));

      act(() => {
        editor.rerender({ doc: "draft two", editable: false });
      });
      await waitFor(() => {
        expect(editor.editor.isEditable()).toBe(false);
        expect(editor.handle.getDoc()).toBe("draft two");
      });

      act(() => {
        editor.rerender({ editable: true });
      });
      await waitFor(() => expect(editor.editor.isEditable()).toBe(true));

      act(() => {
        editor.editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));
    } finally {
      editor.unmount();
    }
  });

  it("merges the immediate parent echo into the current undo step", async () => {
    const editor = await mountEditor();

    try {
      act(() => {
        editor.handle.setDoc("draft one");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.rerender({ doc: "draft one" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.handle.setDoc("draft two ");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two "));

      act(() => {
        editor.rerender({ doc: "draft two" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two"));

      act(() => {
        editor.editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));
    } finally {
      editor.unmount();
    }
  });
});
