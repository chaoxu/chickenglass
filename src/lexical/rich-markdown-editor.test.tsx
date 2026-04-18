import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import {
  $createNodeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  CLICK_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { createElement, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { FileSystemProvider } from "../app/contexts/file-system-context";
import { MemoryFileSystem } from "../app/file-manager";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import "./renderers/block-renderers";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";
import { ACTIVATE_STRUCTURE_EDIT_COMMAND } from "./structure-edit-plugin";

type RichMarkdownEditorProps = ComponentProps<typeof LexicalRichMarkdownEditor>;

const TABLE_MD = `| H1 | H2 |
| --- | --- |
| a | b |`;

const DISPLAY_MATH_MD = `$$
x + 1
$$`;

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

function readSelectionKind(editor: LexicalEditor): "none" | "node" | "other" {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (selection === null) {
      return "none";
    }
    if ($isNodeSelection(selection)) {
      return "node";
    }
    return "other";
  });
}

function getFirstTopLevelKey(editor: LexicalEditor): string {
  const key = editor.getEditorState().read(() => $getRoot().getFirstChild()?.getKey() ?? null);
  if (!key) {
    throw new Error("expected a first top-level node");
  }
  return key;
}

function selectNode(editor: LexicalEditor, key: string): void {
  act(() => {
    editor.update(() => {
      const selection = $createNodeSelection();
      selection.add(key);
      $setSelection(selection);
    }, { discrete: true });
  });
}

describe("ClickableLinkPlugin in read-only mode", () => {
  it("renders link as anchor in read-only mode", async () => {
    const editor = await mountEditor({
      doc: "[example](https://example.com)",
      editable: false,
    });

    try {
      await waitFor(() => {
        const anchor = editor.editor.getRootElement()?.querySelector("a");
        expect(anchor).not.toBeNull();
        expect(anchor?.getAttribute("href")).toBe("https://example.com");
        expect(anchor?.textContent).toBe("example");
      });
    } finally {
      editor.unmount();
    }
  });

  it("link source editor intercepts clicks in editable mode", async () => {
    const editor = await mountEditor({
      doc: "[example](https://example.com)",
      editable: true,
    });

    try {
      await waitFor(() => {
        const anchor = editor.editor.getRootElement()?.querySelector("a");
        expect(anchor).not.toBeNull();
      });

      let handled = false;
      const cleanup = editor.editor.registerCommand(
        CLICK_COMMAND,
        () => {
          handled = true;
          return false;
        },
        0,
      );

      const anchor = editor.editor.getRootElement()?.querySelector("a");
      act(() => {
        anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(handled).toBe(true);
      cleanup();
    } finally {
      editor.unmount();
    }
  });
});

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

describe("TableActionMenuPlugin", () => {
  it("does not expose header-column actions for pipe tables", async () => {
    const editor = await mountEditor({
      doc: TABLE_MD,
      editable: true,
    });

    try {
      const tableCellSelector = "table.cf-lexical-table-block th";
      await waitFor(() => {
        const tableCell = editor.editor.getRootElement()?.querySelector(tableCellSelector);
        expect(tableCell).not.toBeNull();
      });

      const tableCell = editor.editor.getRootElement()?.querySelector(tableCellSelector);
      if (!tableCell) {
        throw new Error("expected a table header cell to open the action menu");
      }

      act(() => {
        fireEvent.contextMenu(tableCell);
      });

      await waitFor(() => {
        const menu = document.querySelector(".cf-table-action-menu");
        expect(menu).not.toBeNull();
        expect(menu?.textContent).toContain("Insert row above");
        expect(menu?.textContent).not.toContain("header column");
      });
    } finally {
      editor.unmount();
    }
  });
});

describe("StructureEditProvider selection ownership", () => {
  it("releases parent selection when activating a structure surface by command", async () => {
    const editor = await mountEditor({
      doc: DISPLAY_MATH_MD,
      editable: true,
    });

    try {
      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-display-math-body",
          ),
        ).not.toBeNull();
      });
      const blockKey = getFirstTopLevelKey(editor.editor);
      selectNode(editor.editor, blockKey);
      expect(readSelectionKind(editor.editor)).toBe("node");

      let handled = false;
      act(() => {
        handled = editor.editor.dispatchCommand(ACTIVATE_STRUCTURE_EDIT_COMMAND, {
          blockKey,
          surface: "display-math-source",
          variant: "display-math",
        });
      });

      expect(handled).toBe(true);
      await waitFor(() => {
        expect(readSelectionKind(editor.editor)).toBe("none");
      });
      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-structure-source-editor--math",
          ),
        ).not.toBeNull();
      });
    } finally {
      editor.unmount();
    }
  });

  it("opens a structure surface from a selected block without repairing NodeSelection on click", async () => {
    const editor = await mountEditor({
      doc: DISPLAY_MATH_MD,
      editable: true,
    });

    try {
      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-display-math-body",
          ),
        ).not.toBeNull();
      });
      const blockKey = getFirstTopLevelKey(editor.editor);
      selectNode(editor.editor, blockKey);
      expect(readSelectionKind(editor.editor)).toBe("node");

      const body = editor.editor.getRootElement()?.querySelector(
        ".cf-lexical-display-math-body",
      );
      if (!body) {
        throw new Error("expected display math body");
      }

      act(() => {
        fireEvent.click(body);
      });

      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-structure-source-editor--math",
          ),
        ).not.toBeNull();
      });
      expect(readSelectionKind(editor.editor)).toBe("none");
    } finally {
      editor.unmount();
    }
  });
});

describe("__editor selection bridge (rich mode)", () => {
  it("setSelection moves the Lexical selection for a prose document with no tagged blocks", async () => {
    const editor = await mountEditor({ doc: "plain prose only" });

    try {
      act(() => {
        editor.handle.setSelection(3, 3);
      });

      const anchorInFirstBlock = editor.editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        const firstChild = $getRoot().getFirstChild();
        return selection.anchor.getNode().getTopLevelElement()?.getKey() === firstChild?.getKey();
      });
      expect(anchorInFirstBlock).toBe(true);
    } finally {
      editor.unmount();
    }
  });

  it("getSelection reports the live source position when the caret is inside a heading", async () => {
    const editor = await mountEditor({ doc: "# Title\n\nbody" });

    try {
      await waitFor(() => {
        const heading = editor.editor.getRootElement()?.querySelector<HTMLElement>(
          ".cf-lexical-heading[data-coflat-heading-pos]",
        );
        expect(heading).not.toBeNull();
      });

      act(() => {
        editor.editor.update(() => {
          const first = $getRoot().getFirstChild();
          if (first && $isElementNode(first)) {
            first.selectStart();
          }
        });
      });

      await waitFor(() => {
        expect(editor.handle.getSelection().anchor).toBe(0);
      });
    } finally {
      editor.unmount();
    }
  });
});
