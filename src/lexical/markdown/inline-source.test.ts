import { $isLinkNode } from "@lexical/link";
import { $getRoot, $isElementNode, $isTextNode } from "lexical";
import { describe, expect, it } from "vitest";

import { createHeadlessCoflatEditor, setLexicalMarkdown } from "../markdown";
import {
  findMatchingMarkdownLinkSource,
  findMatchingFormattedTextSource,
  parseMarkdownLinkSource,
  serializeMarkdownLinkSource,
} from "./inline-source";

describe("inline source helpers", () => {
  it("preserves formatted labels and titles when serializing link source", () => {
    const markdown = 'Alpha [**rich** link](https://example.com/path "A title") omega.';
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, markdown);

    const state = editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      if (!$isElementNode(paragraph)) {
        return null;
      }
      const link = paragraph.getChildren().find($isLinkNode) ?? null;
      if (!link) {
        return null;
      }
      return {
        matched: findMatchingMarkdownLinkSource(markdown, link)?.raw ?? null,
        serialized: serializeMarkdownLinkSource(link),
      };
    });

    expect(state).toEqual({
      matched: '[**rich** link](https://example.com/path "A title")',
      serialized: '[**rich** link](https://example.com/path "A title")',
    });
  });

  it("parses escaped markdown link titles", () => {
    expect(parseMarkdownLinkSource('[link](https://example.com "A \\"quoted\\" title")')).toMatchObject({
      labelMarkdown: "link",
      title: 'A "quoted" title',
      url: "https://example.com",
    });
  });

  it("matches imported underscore formatted text sources", () => {
    const markdown = "Alpha _italic_ omega.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, markdown);

    const match = editor.getEditorState().read(() => {
      const text = $getRoot().getAllTextNodes().find((node) =>
        node.getTextContent() === "italic" && node.hasFormat("italic")
      );
      return $isTextNode(text) ? findMatchingFormattedTextSource(markdown, text) : null;
    });

    expect(match).toMatchObject({
      openLength: 1,
      source: "_italic_",
    });
  });
});
