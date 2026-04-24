import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import {
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  UNDO_COMMAND,
} from "lexical";
import { type ComponentProps, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MemoryFileSystem } from "../app/file-manager";
import { FileSystemProvider } from "../filesystem/file-system-context";
import { setActiveEditor } from "./active-editor-tracker";
import { LexicalMarkdownEditor } from "./markdown-editor";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import { registerCoflatDecoratorRenderers } from "./renderers/block-renderers";
import { HEADING_SOURCE_SELECTOR, RAW_BLOCK_SOURCE_SELECTOR } from "./source-position-contract";

type MarkdownEditorProps = ComponentProps<typeof LexicalMarkdownEditor>;

registerCoflatDecoratorRenderers();

const MOUNT_ONLY_NESTED_FIELD_DOC = [
  "::: {.theorem #thm:mount-echo title=\"Mount Echo\"}",
  "A nested block body should mount without publishing a document edit.",
  ":::",
  "",
].join("\n");

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
  it("does not report mount-only nested field echoes as dirty", async () => {
    const onDirtyChange = vi.fn();
    const onDocChange = vi.fn();
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: MOUNT_ONLY_NESTED_FIELD_DOC,
      editorMode: "lexical",
      onDirtyChange,
      onDocChange,
      onTextChange,
    });

    try {
      await waitFor(() => {
        const root = editor.editor.getRootElement();
        expect(root?.querySelector(".cf-lexical-nested-editor--title")).not.toBeNull();
        expect(root?.querySelector(".cf-lexical-nested-editor--block-body")).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onDirtyChange).not.toHaveBeenCalled();
      expect(onDocChange).not.toHaveBeenCalled();
      expect(onTextChange).not.toHaveBeenCalled();
    } finally {
      editor.unmount();
    }
  });

  it("publishes a debounced markdown snapshot after rich text edits", async () => {
    const onDocChange = vi.fn();
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: "Alpha",
      editorMode: "lexical",
      onDocChange,
      onTextChange,
    });

    try {
      const rootElement = editor.editor.getRootElement();
      if (!rootElement) {
        throw new Error("expected editor root");
      }

      act(() => {
        fireEvent.keyDown(rootElement, { key: "Backspace" });
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected text");
          }
          text.select(text.getTextContentSize(), text.getTextContentSize());
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            throw new Error("expected range selection");
          }
          selection.insertText(" Beta");
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(onTextChange).toHaveBeenCalledWith("Alpha Beta");
      });
      expect(onDocChange).toHaveBeenCalledWith([{
        from: 5,
        insert: " Beta",
        to: 5,
      }]);
    } finally {
      editor.unmount();
    }
  });

  it("flushes pending rich text edits before switching to source mode", async () => {
    const onDocChange = vi.fn();
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: "Alpha",
      editorMode: "lexical",
      onDocChange,
      onTextChange,
    });

    try {
      const rootElement = editor.editor.getRootElement();
      if (!rootElement) {
        throw new Error("expected editor root");
      }

      act(() => {
        fireEvent.keyDown(rootElement, { key: "Backspace" });
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected text");
          }
          text.select(text.getTextContentSize(), text.getTextContentSize());
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            throw new Error("expected range selection");
          }
          selection.insertText(" Beta");
        }, { discrete: true });
      });

      act(() => {
        editor.rerender({ doc: "Alpha", editorMode: "source" });
      });

      await waitFor(() => {
        expect(editor.handle.getDoc()).toBe("Alpha Beta");
      });
      expect(onTextChange).toHaveBeenCalledWith("Alpha Beta");
      expect(onDocChange).toHaveBeenCalledWith([{
        from: 5,
        insert: " Beta",
        to: 5,
      }]);
    } finally {
      editor.unmount();
    }
  });

  it("does not publish document snapshots for selection-only rich cursor movement", async () => {
    const onDocChange = vi.fn();
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: "Alpha **Beta** Gamma",
      editorMode: "lexical",
      onDocChange,
      onTextChange,
    });

    try {
      act(() => {
        editor.handle.setSelection(0, 5);
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onDocChange).not.toHaveBeenCalled();
      expect(onTextChange).not.toHaveBeenCalled();
    } finally {
      editor.unmount();
    }
  });

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

describe("LexicalMarkdownEditor mode round-trip (issue #99)", () => {
  // Representative Pandoc-flavored fixture covering the shapes the bug
  // report flagged as dropped: YAML frontmatter, attributed headings, bullet
  // lists. Source mode stores the text verbatim in a CodeBlockNode, so its
  // `getDoc()` returns an exact byte-for-byte copy — this is the lossless
  // side of the mode pair we assert against. The lexical-side serializer
  // (`getLexicalMarkdown`) is lossy for these shapes; the fix in
    // LexicalSourceBridgePlugin avoids routing through it on a pure mode toggle,
  // so the text that lands in source mode after a rich → source switch is
  // the canonical committed doc, not the lossy re-serialization.
  const FIXTURE = [
    "---",
    "title: Round Trip",
    "---",
    "",
    "# Intro {-}",
    "",
    "Body paragraph.",
    "",
    "- one",
    "- two",
    "- three",
    "",
    "## Methods {.unnumbered}",
    "",
    "More **bold** text.",
    "",
  ].join("\n");

  it("keeps canonical doc text when switching rich → source with no edits", async () => {
    const editor = await mountEditor({ doc: FIXTURE, editorMode: "lexical" });

    try {
      act(() => {
        editor.rerender({ doc: FIXTURE, editorMode: "source" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe(FIXTURE));
    } finally {
      editor.unmount();
    }
  });

  it("keeps canonical doc text on rich → source → rich → source round-trip", async () => {
    const editor = await mountEditor({ doc: FIXTURE, editorMode: "lexical" });

    try {
      act(() => {
        editor.rerender({ doc: FIXTURE, editorMode: "source" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe(FIXTURE));

      act(() => {
        editor.rerender({ doc: FIXTURE, editorMode: "lexical" });
      });
      act(() => {
        editor.rerender({ doc: FIXTURE, editorMode: "source" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe(FIXTURE));
    } finally {
      editor.unmount();
    }
  });

  it("does not let delayed rich-mode sync overwrite an immediate edit after source → rich", async () => {
    const doc = [
      "# Authoring",
      "",
      "::: {.definition #def:stable-surface} Stable Surface",
      "A stable surface.",
      ":::",
      "",
      "::: {.theorem #thm:authoring-invariant} Authoring Invariant",
      "For every edit burst $E$, the serialized markdown remains canonical.",
      ":::",
      "",
      "::: {.proof}",
      "The proof is by direct inspection. First we edit in Source, then in Lexical. The final document still contains @def:stable-surface.",
      ":::",
      "",
      "$$",
      "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "$$ {#eq:authoring-integral}",
      "",
      "| Surface | Checked |",
      "| --- | --- |",
      "| Lexical | yes |",
      "",
    ].join("\n");
    const editor = await mountEditor({ doc, editorMode: "source" });

    try {
      await waitFor(() => expect(editor.handle.getDoc()).toBe(doc));

      act(() => {
        editor.rerender({ doc, editorMode: "lexical" });
      });

      const insertAt = doc.indexOf("The final document still contains");
      act(() => {
        editor.handle.setSelection(insertAt, insertAt);
        editor.handle.insertText("Lexical edit: ");
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(editor.handle.getDoc()).toContain("Lexical edit:");
      expect(editor.handle.getDoc()).toContain("The final document still contains");
    } finally {
      editor.unmount();
    }
  });
});

describe("LexicalMarkdownEditor rich selection bridge", () => {
  it("publishes live rich caret movement with source offsets", async () => {
    const onSelectionChange = vi.fn();
    const editor = await mountEditor({
      doc: "Alpha Beta",
      editorMode: "lexical",
      onSelectionChange,
    });

    try {
      onSelectionChange.mockClear();
      act(() => {
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected first paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected first text node");
          }
          text.select(3, 3);
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(onSelectionChange).toHaveBeenLastCalledWith({
          anchor: 3,
          focus: 3,
          from: 3,
          to: 3,
        });
      });
    } finally {
      editor.unmount();
    }
  });

  it("publishes live rich range selections with source offsets", async () => {
    const onSelectionChange = vi.fn();
    const editor = await mountEditor({
      doc: "Alpha Beta",
      editorMode: "lexical",
      onSelectionChange,
    });

    try {
      onSelectionChange.mockClear();
      act(() => {
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected first paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected first text node");
          }
          text.select(6, 10);
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(onSelectionChange).toHaveBeenLastCalledWith({
          anchor: 6,
          focus: 10,
          from: 6,
          to: 10,
        });
      });
    } finally {
      editor.unmount();
    }
  });

  it("does not collapse a non-collapsed rich selection on mouseup", async () => {
    const onSelectionChange = vi.fn();
    const editor = await mountEditor({
      doc: "# Alpha Beta",
      editorMode: "lexical",
      onSelectionChange,
    });

    try {
      const maybeHeading = await waitFor(() => {
        const nextHeading = editor.editor.getRootElement()?.querySelector<HTMLElement>(
          HEADING_SOURCE_SELECTOR,
        );
        expect(nextHeading).not.toBeNull();
        return nextHeading;
      });
      if (!maybeHeading) {
        throw new Error("expected heading");
      }
      const heading = maybeHeading;
      const textWalker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      const headingTextNode = textWalker.nextNode();
      if (!headingTextNode?.textContent || headingTextNode.textContent.length < 10) {
        throw new Error("expected heading text");
      }

      onSelectionChange.mockClear();
      act(() => {
        editor.editor.update(() => {
          const firstBlock = $getRoot().getFirstChild();
          if (!$isElementNode(firstBlock)) {
            throw new Error("expected first heading");
          }
          const text = firstBlock.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected heading text node");
          }
          text.select(6, 10);
        }, { discrete: true });
      });

      await waitFor(() => {
        const selection = onSelectionChange.mock.lastCall?.[0];
        expect(selection?.from).toBeLessThan(selection?.to ?? 0);
      });
      const publishedRange = onSelectionChange.mock.lastCall?.[0];

      const domRange = document.createRange();
      domRange.setStart(headingTextNode, 6);
      domRange.setEnd(headingTextNode, 10);
      const domSelection = window.getSelection();
      domSelection?.removeAllRanges();
      domSelection?.addRange(domRange);
      expect(domSelection?.isCollapsed).toBe(false);

      act(() => {
        fireEvent.mouseUp(heading);
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onSelectionChange.mock.lastCall?.[0]).toEqual(publishedRange);
    } finally {
      window.getSelection()?.removeAllRanges();
      editor.unmount();
    }
  });

  it("keeps the source selection at the deletion point after rich prose deletion", async () => {
    const doc = [
      "Alpha bravo charlie delta.",
      "",
      "Second paragraph.",
    ].join("\n");
    const editor = await mountEditor({
      doc,
      editorMode: "lexical",
    });

    try {
      act(() => {
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected first paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected first text node");
          }
          text.select(6, 12);
        }, { discrete: true });
      });

      expect(editor.handle.getSelection()).toMatchObject({
        anchor: 6,
        focus: 12,
      });

      act(() => {
        editor.editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            throw new Error("expected range selection");
          }
          selection.removeText();
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(editor.handle.getDoc()).toBe(doc.replace("bravo ", ""));
      });
      await waitFor(() => {
        expect(editor.handle.getSelection()).toMatchObject({
          anchor: 6,
          focus: 6,
        });
      });
    } finally {
      editor.unmount();
    }
  });

  it("maps rich setSelection ranges across formatted text nodes", async () => {
    const doc = "Alpha **bravo** charlie";
    const editor = await mountEditor({
      doc,
      editorMode: "lexical",
    });

    try {
      act(() => {
        editor.handle.setSelection(0, doc.length);
      });

      await waitFor(() => {
        expect(editor.handle.getSelection()).toMatchObject({
          anchor: 0,
          focus: doc.length,
        });
      });
    } finally {
      editor.unmount();
    }
  });

  it("reports the live source position when display math owns the selection", async () => {
    const doc = [
      "Before",
      "",
      "$$",
      "x",
      "$$",
      "",
      "After",
    ].join("\n");
    const editor = await mountEditor({
      doc,
      editorMode: "lexical",
    });

    try {
      setActiveEditor(editor.editor);
      await waitFor(() => {
        const rawBlock = editor.editor.getRootElement()?.querySelector(RAW_BLOCK_SOURCE_SELECTOR);
        expect(rawBlock).not.toBeNull();
      });

      act(() => {
        const rawBlock = editor.editor.getRootElement()?.querySelector(RAW_BLOCK_SOURCE_SELECTOR);
        if (!(rawBlock instanceof HTMLElement)) {
          throw new Error("expected display math element");
        }

        editor.editor.update(() => {
          const node = $getNearestNodeFromDOMNode(rawBlock);
          if (!node) {
            throw new Error("expected display math node");
          }
          const selection = $createNodeSelection();
          selection.add(node.getKey());
          $setSelection(selection);
        }, { discrete: true });
      });

      const expected = doc.indexOf("$$\nx\n$$");
      await waitFor(() => {
        expect(editor.handle.getSelection().anchor).toBe(expected);
      });
    } finally {
      editor.unmount();
    }
  });

  it("keeps the last mapped rich selection when a nested editor becomes active", async () => {
    const doc = [
      "Before",
      "",
      "$$",
      "x",
      "$$",
      "",
      "After",
    ].join("\n");
    const editor = await mountEditor({
      doc,
      editorMode: "lexical",
    });
    const nested = await mountEditor({
      doc: "nested",
      editorMode: "source",
    });

    try {
      setActiveEditor(editor.editor);
      await waitFor(() => {
        const rawBlock = editor.editor.getRootElement()?.querySelector(RAW_BLOCK_SOURCE_SELECTOR);
        expect(rawBlock).not.toBeNull();
      });

      act(() => {
        const rawBlock = editor.editor.getRootElement()?.querySelector(RAW_BLOCK_SOURCE_SELECTOR);
        if (!(rawBlock instanceof HTMLElement)) {
          throw new Error("expected display math element");
        }

        editor.editor.update(() => {
          const node = $getNearestNodeFromDOMNode(rawBlock);
          if (!node) {
            throw new Error("expected display math node");
          }
          const selection = $createNodeSelection();
          selection.add(node.getKey());
          $setSelection(selection);
        }, { discrete: true });
      });

      const expected = doc.indexOf("$$\nx\n$$");
      await waitFor(() => {
        expect(editor.handle.getSelection().anchor).toBe(expected);
      });

      act(() => {
        setActiveEditor(nested.editor);
        editor.editor.update(() => {
          const root = editor.editor.getRootElement();
          const firstParagraph = root?.querySelector("p");
          if (!(firstParagraph instanceof HTMLElement)) {
            throw new Error("expected first paragraph");
          }
          const node = $getNearestNodeFromDOMNode(firstParagraph);
          if (!node) {
            throw new Error("expected first paragraph node");
          }
          node.selectStart();
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(editor.handle.getSelection().anchor).toBe(expected);
      });
    } finally {
      setActiveEditor(editor.editor);
      editor.unmount();
      nested.unmount();
    }
  });
});
