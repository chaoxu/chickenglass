import { COMMAND_PRIORITY_LOW } from "lexical";
import { describe, expect, it } from "vitest";

import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import {
  mapVisibleTextSelectionToMarkdown,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-selection";

describe("source selection mapping", () => {
  it("opens link source reveal for titled links with formatted labels", () => {
    const doc = 'Alpha [**rich** link](https://example.com/path "A title") omega.';
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    let request: CursorRevealOpenRequest | null = null;
    const unregister = editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (nextRequest) => {
        request = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    try {
      const offset = doc.indexOf("title") + 2;
      expect(selectSourceOffsetsInRichLexicalRoot(editor, doc, offset)).toBe(true);
      expect(request).toMatchObject({
        adapterId: "link",
        caretOffset: offset - doc.indexOf("[**rich** link]"),
        source: '[**rich** link](https://example.com/path "A title")',
      });
    } finally {
      unregister();
    }
  });

  it("uses imported formatted-text delimiters when mapping source offsets", () => {
    const doc = "Alpha _italic_ omega.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    let request: CursorRevealOpenRequest | null = null;
    const unregister = editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (nextRequest) => {
        request = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    try {
      const offset = doc.indexOf("_");
      expect(selectSourceOffsetsInRichLexicalRoot(editor, doc, offset)).toBe(true);
      expect(request).toMatchObject({
        adapterId: "text-format",
        caretOffset: 0,
        source: "_italic_",
      });
    } finally {
      unregister();
    }
  });

  it("opens heading attribute source reveal from source offsets", () => {
    const doc = "# Intro {#sec:intro}\n\nBody\n";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    let request: CursorRevealOpenRequest | null = null;
    const unregister = editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (nextRequest) => {
        request = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    try {
      const offset = doc.indexOf("sec:intro") + 4;
      expect(selectSourceOffsetsInRichLexicalRoot(editor, doc, offset)).toBe(true);
      expect(request).toMatchObject({
        adapterId: "heading-attribute",
        caretOffset: offset - doc.indexOf(" {#sec:intro}"),
        source: " {#sec:intro}",
      });
    } finally {
      unregister();
    }
  });

  it("maps visible selections after formatted title text to markdown offsets", () => {
    const marker = "NestedTitleEditNeedle";
    const markdown = `Hover Preview Stress Test **${marker}**`;
    const markerStart = "Hover Preview Stress Test ".length;
    expect(mapVisibleTextSelectionToMarkdown(markdown, {
      anchor: markerStart,
      focus: markerStart + marker.length,
      from: markerStart,
      to: markerStart + marker.length,
    })).toEqual({
      anchor: markdown.indexOf(marker),
      focus: markdown.indexOf(marker) + marker.length,
      from: markdown.indexOf(marker),
      to: markdown.indexOf(marker) + marker.length,
    });
  });
});
