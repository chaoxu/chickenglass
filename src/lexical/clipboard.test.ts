import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  COFLAT_MARKDOWN_MIME,
  getCoflatClipboardData,
  type ClipboardRenderContext,
} from "./clipboard";
import {
  createHeadlessCoflatEditor,
  setLexicalMarkdown,
} from "./markdown";
import { buildRenderIndex } from "./rendering";

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
});
