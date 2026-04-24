import { $getRoot } from "lexical";
import { describe, expect, it } from "vitest";

import { collectSourceBoundaryRanges } from "../lib/markdown/block-scanner";
import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import { findLexicalSourceBlockNodeByIdentity } from "./source-block-identity";

describe("source-block-identity", () => {
  it("resolves duplicate plain paragraphs by source identity instead of traversal order", () => {
    const doc = [
      "Repeated paragraph.",
      "",
      "Repeated paragraph.",
    ].join("\n");
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    const ranges = collectSourceBoundaryRanges(doc, {
      includeFootnoteTerminatingBlank: true,
    });

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      const secondRange = ranges[2];
      expect(secondRange?.raw).toBe("Repeated paragraph.");
      const target = secondRange
        ? findLexicalSourceBlockNodeByIdentity(
            editor,
            [...children].reverse(),
            doc,
            { ...secondRange, index: 2 },
          )
        : null;

      expect(target?.getKey()).toBe(children[2]?.getKey());
    });
  });

  it("resolves duplicate fenced divs by source identity instead of raw text uniqueness", () => {
    const repeated = [
      "::: {.proof}",
      "Repeated body.",
      ":::",
    ].join("\n");
    const doc = [repeated, "", repeated].join("\n");
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    const ranges = collectSourceBoundaryRanges(doc, {
      includeFootnoteTerminatingBlank: true,
    });

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      const secondRange = ranges[2];
      expect(secondRange?.raw).toBe(repeated);
      const target = secondRange
        ? findLexicalSourceBlockNodeByIdentity(
            editor,
            [...children].reverse(),
            doc,
            { ...secondRange, index: 2 },
          )
        : null;

      expect(target?.getKey()).toBe(children[2]?.getKey());
    });
  });
});
