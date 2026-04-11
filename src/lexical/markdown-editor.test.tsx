import { act, render, waitFor } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import { UNDO_COMMAND } from "lexical";
import { createElement, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { FileSystemProvider } from "../app/contexts/file-system-context";
import { MemoryFileSystem } from "../app/file-manager";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import { LexicalMarkdownEditor } from "./markdown-editor";

type MarkdownEditorProps = ComponentProps<typeof LexicalMarkdownEditor>;

async function mountEditor(overrides: Partial<MarkdownEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  let handle: MarkdownEditorHandle | null = null;
  let currentProps: MarkdownEditorProps = {
    doc: "seed",
    editorMode: "lexical",
    onEditorReady: (nextHandle, nextEditor) => {
      handle = nextHandle;
      editor = nextEditor;
    },
    testId: null,
    ...overrides,
  };
  const fs = new MemoryFileSystem();
  const view = render(
    createElement(
      FileSystemProvider,
      { value: fs },
      createElement(LexicalMarkdownEditor, currentProps),
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
        throw new Error("expected editor to be ready");
      }
      return handle;
    },
    rerender(nextOverrides: Partial<MarkdownEditorProps> = {}) {
      currentProps = {
        ...currentProps,
        ...nextOverrides,
      };
      view.rerender(
        createElement(
          FileSystemProvider,
          { value: fs },
          createElement(LexicalMarkdownEditor, currentProps),
        ),
      );
    },
    unmount() {
      view.unmount();
    },
  };
}

describe("LexicalMarkdownEditor history", () => {
  it("preserves undo history across lexical/source mode switches", async () => {
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
        editor.handle.setDoc("draft two");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two"));

      act(() => {
        editor.rerender({ doc: "draft two", editorMode: "source" });
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

  it("merges an immediate parent echo into the current undo step", async () => {
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

  it("keeps earlier undo history after an external reload", async () => {
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
        editor.rerender({ doc: "reloaded from disk" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("reloaded from disk"));

      act(() => {
        editor.editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));
    } finally {
      editor.unmount();
    }
  });
});
