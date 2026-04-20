import { COMMAND_PRIORITY_LOW } from "lexical";
import { describe, expect, it } from "vitest";

import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import { selectSourceOffsetsInRichLexicalRoot } from "./source-selection";

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
});
