import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  PASTE_COMMAND,
  getNearestEditorFromDOMNode,
} from "lexical";
import { describe, expect, it, vi } from "vitest";

import {
  COFLAT_MARKDOWN_MIME,
  getCoflatClipboardData,
  getCoflatMarkdownFromDataTransfer,
  insertCoflatMarkdownAtSelection,
  type ClipboardRenderContext,
} from "./clipboard";
import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import { MemoryFileSystem } from "../app/file-manager";
import { FileSystemProvider } from "../filesystem/file-system-context";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";
import { buildRenderIndex } from "./markdown/reference-index";

function createRenderContext(doc: string): ClipboardRenderContext {
  return {
    citations: {
      backlinks: new Map(),
      citedIds: [],
      store: new Map(),
    },
    config: {},
    docPath: undefined,
    renderIndex: buildRenderIndex(doc, {}),
    resolveAssetUrl: () => null,
  };
}

describe("coflat clipboard helpers", () => {
  it("emits canonical markdown, rendered HTML, and custom coflat markdown data", () => {
    const doc = "**bold** $x^2$";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    let clipboardData = null;

    editor.update(() => {
      $getRoot().select(0, $getRoot().getChildrenSize());
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("expected a range selection");
      }

      clipboardData = getCoflatClipboardData(editor, createRenderContext(doc), selection);
    }, { discrete: true });

    expect(clipboardData).not.toBeNull();
    expect(clipboardData?.["text/plain"]).toBe(doc);
    expect(clipboardData?.[COFLAT_MARKDOWN_MIME]).toBe(doc);
    expect(clipboardData?.["application/x-lexical-editor"]).toContain("\"namespace\":");
    expect(clipboardData?.["text/html"]).toContain("<strong>bold</strong>");
    expect(clipboardData?.["text/html"]).toContain("katex");
  });

  it("skips clipboard serialization for collapsed selections", () => {
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, "paragraph");

    let clipboardData = null;

    editor.update(() => {
      $getRoot().selectEnd();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("expected a range selection");
      }

      clipboardData = getCoflatClipboardData(editor, createRenderContext("paragraph"), selection);
    }, { discrete: true });

    expect(clipboardData).toBeNull();
  });

  it("inserts coflat markdown into the current selection", () => {
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, "seed");

    editor.update(() => {
      const textNode = $getRoot().getFirstDescendant();
      if (!$isTextNode(textNode)) {
        throw new Error("expected a text node");
      }

      textNode.select(0, textNode.getTextContentSize());
    }, { discrete: true });

    expect(insertCoflatMarkdownAtSelection(editor, "**bold** $x^2$")).toBe(true);
    expect(getLexicalMarkdown(editor)).toBe("**bold** $x^2$");
  });

  it("normalizes pasted list-owned raw blocks through the shared importer", () => {
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, "seed");

    editor.update(() => {
      const textNode = $getRoot().getFirstDescendant();
      if (!$isTextNode(textNode)) {
        throw new Error("expected a text node");
      }

      textNode.select(0, textNode.getTextContentSize());
    }, { discrete: true });

    expect(insertCoflatMarkdownAtSelection(editor, [
      "1. Display math:",
      "",
      "   $$",
      "   x^2",
      "   $$",
    ].join("\n"))).toBe(true);
    expect(getLexicalMarkdown(editor)).toBe([
      "1. Display math:",
      "   $$",
      "   x^2",
      "   $$",
    ].join("\n"));
  });

  it("does not insert coflat markdown when there is no current selection", () => {
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, "seed");

    editor.update(() => {
      $setSelection(null);
    }, { discrete: true });

    expect(insertCoflatMarkdownAtSelection(editor, "**bold** $x^2$")).toBe(false);
    expect(getLexicalMarkdown(editor)).toBe("seed");
  });

  it("emits HTML and canonical markdown for fenced code block selections", () => {
    const doc = "```ts\nconst answer = 42;\n```";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    let clipboardData = null;

    editor.update(() => {
      $getRoot().select(0, $getRoot().getChildrenSize());
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("expected a range selection");
      }

      clipboardData = getCoflatClipboardData(editor, createRenderContext(doc), selection);
    }, { discrete: true });

    expect(clipboardData).not.toBeNull();
    expect(clipboardData?.["text/plain"]).toBe("const answer = 42;");
    expect(clipboardData?.[COFLAT_MARKDOWN_MIME]).toBe(doc);
    expect(clipboardData?.["text/html"]).toContain("<pre");
    expect(clipboardData?.["text/html"]).toContain("const answer = 42;");
  });

  it("reads coflat markdown from custom clipboard data", () => {
    expect(getCoflatMarkdownFromDataTransfer({
      getData(type: string) {
        return type === COFLAT_MARKDOWN_MIME ? "## heading" : "";
      },
    })).toBe("## heading");

    expect(getCoflatMarkdownFromDataTransfer({
      getData() {
        return "";
      },
    })).toBeNull();
  });

  it("handles coflat-origin paste through PASTE_COMMAND in the live editor", async () => {
    const onTextChange = vi.fn();
    const fs = new MemoryFileSystem();
    let rootElement: HTMLElement | null = null;
    vi.stubGlobal("DragEvent", class DragEvent extends Event {});
    vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});

    const view = render(
      createElement(FileSystemProvider, { value: fs },
        createElement(LexicalRichMarkdownEditor, {
          doc: "seed",
          onRootElementChange: (nextRoot: HTMLElement | null) => {
            rootElement = nextRoot;
          },
          requireUserEditFlag: false,
          onTextChange,
        })),
    );

    try {
      await waitFor(() => expect(rootElement).not.toBeNull());

      const editor = getNearestEditorFromDOMNode(rootElement);
      expect(editor).not.toBeNull();
      if (!editor) {
        throw new Error("expected a lexical editor instance");
      }

      act(() => {
        editor.update(() => {
          const textNode = $getRoot().getFirstDescendant();
          if (!$isTextNode(textNode)) {
            throw new Error("expected an initial text node");
          }

          textNode.select(0, textNode.getTextContentSize());
        });
      });

      const clipboardData = {
        files: [],
        getData(type: string) {
          return type === COFLAT_MARKDOWN_MIME ? "**bold** $x^2$" : "";
        },
        types: [COFLAT_MARKDOWN_MIME],
      } as unknown as DataTransfer;
      const preventDefault = vi.fn();

      act(() => {
        editor.dispatchCommand(PASTE_COMMAND, {
          clipboardData,
          preventDefault,
          target: rootElement,
        } as unknown as ClipboardEvent);
      });

      await waitFor(() => {
        expect(getLexicalMarkdown(editor)).toBe("**bold** $x^2$");
        expect(onTextChange).toHaveBeenCalledWith("**bold** $x^2$");
      });
      expect(preventDefault).toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it("falls through when coflat paste arrives without an editor selection", async () => {
    const fs = new MemoryFileSystem();
    let rootElement: HTMLElement | null = null;
    vi.stubGlobal("DragEvent", class DragEvent extends Event {});
    vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});

    const view = render(
      createElement(FileSystemProvider, { value: fs },
        createElement(LexicalRichMarkdownEditor, {
          doc: "seed",
          onRootElementChange: (nextRoot: HTMLElement | null) => {
            rootElement = nextRoot;
          },
          requireUserEditFlag: false,
        })),
    );

    try {
      await waitFor(() => expect(rootElement).not.toBeNull());

      const editor = getNearestEditorFromDOMNode(rootElement);
      expect(editor).not.toBeNull();
      if (!editor) {
        throw new Error("expected a lexical editor instance");
      }

      act(() => {
        editor.update(() => {
          $setSelection(null);
        });
      });

      const clipboardData = {
        files: [],
        getData(type: string) {
          return type === COFLAT_MARKDOWN_MIME ? "**bold** $x^2$" : "";
        },
        types: [COFLAT_MARKDOWN_MIME],
      } as unknown as DataTransfer;
      const preventDefault = vi.fn();

      act(() => {
        editor.dispatchCommand(PASTE_COMMAND, {
          clipboardData,
          preventDefault,
          target: rootElement,
        } as unknown as ClipboardEvent);
      });

      expect(getLexicalMarkdown(editor)).toBe("seed");
      expect(preventDefault).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
