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

  it("parses non-canonical link destinations and title delimiters", () => {
    expect(parseMarkdownLinkSource("[nested [label]](<https://example.com/a b> 'single title')")).toMatchObject({
      labelMarkdown: "nested [label]",
      title: "single title",
      url: "https://example.com/a b",
    });
    expect(parseMarkdownLinkSource("[paren](https://example.com/a(b)c (paren title))")).toMatchObject({
      labelMarkdown: "paren",
      title: "paren title",
      url: "https://example.com/a(b)c",
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

  it("matches imported combined formatted text sources", () => {
    const markdown = "Alpha _**both**_ and ___also both___.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, markdown);

    const matches = editor.getEditorState().read(() =>
      $getRoot().getAllTextNodes()
        .filter((node) =>
          node.getTextContent().includes("both")
          && node.hasFormat("bold")
          && node.hasFormat("italic")
        )
        .map((node) => findMatchingFormattedTextSource(markdown, node))
        .map((match) => match?.source ?? null)
    );

    expect(matches).toEqual(["_**both**_", "___also both___"]);
  });
});
