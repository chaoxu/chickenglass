import { $getRoot } from "lexical";
import { describe, expect, it } from "vitest";

import {
  applyIncrementalRichDocumentSync,
  type IncrementalRichDocumentSyncResult,
} from "./incremental-rich-sync";
import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";

function readTopLevelKeys(editor: ReturnType<typeof createHeadlessCoflatEditor>): string[] {
  return editor.getEditorState().read(() =>
    $getRoot().getChildren().map((node) => node.getKey())
  );
}

function applyIncrementalChange(previousMarkdown: string, nextMarkdown: string): {
  readonly result: IncrementalRichDocumentSyncResult;
  readonly editor: ReturnType<typeof createHeadlessCoflatEditor>;
} {
  const editor = createHeadlessCoflatEditor();
  setLexicalMarkdown(editor, previousMarkdown);
  return {
    result: applyIncrementalRichDocumentSync(editor, previousMarkdown, nextMarkdown),
    editor,
  };
}

describe("applyIncrementalRichDocumentSync", () => {
  it("updates one plain top-level paragraph in place and leaves sibling blocks intact", () => {
    const previousMarkdown = "Alpha beta.\n\nSecond paragraph.";
    const nextMarkdown = "Alpha gamma.\n\nSecond paragraph.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, previousMarkdown);
    const previousKeys = readTopLevelKeys(editor);

    const result = applyIncrementalRichDocumentSync(editor, previousMarkdown, nextMarkdown);

    expect(result).toMatchObject({
      applied: true,
      blockFrom: 0,
      blockTo: "Alpha beta.".length,
      nextBlockSource: "Alpha gamma.",
      nextBlockTo: "Alpha gamma.".length,
    });
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
    const nextKeys = readTopLevelKeys(editor);
    expect(nextKeys).toHaveLength(previousKeys.length);
    expect(nextKeys[0]).toBe(previousKeys[0]);
    expect(nextKeys.slice(1)).toEqual(previousKeys.slice(1));
  });

  it("keeps inline markdown replacements inside a single paragraph", () => {
    const previousMarkdown = "Alpha **bold** and $x$.";
    const nextMarkdown = "Alpha **strong** and $x$.";
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result.applied).toBe(true);
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
  });

  it("updates a later plain paragraph without targeting the blank separator node", () => {
    const previousMarkdown = "Alpha\n\nSecond paragraph.";
    const nextMarkdown = "Alpha\n\nSecond changed.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, previousMarkdown);
    const previousKeys = readTopLevelKeys(editor);

    const result = applyIncrementalRichDocumentSync(editor, previousMarkdown, nextMarkdown);

    expect(result).toMatchObject({
      applied: true,
      blockFrom: previousMarkdown.indexOf("Second"),
      nextBlockSource: "Second changed.",
      nextBlockTo: nextMarkdown.length,
    });
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
    const nextKeys = readTopLevelKeys(editor);
    expect(nextKeys[0]).toBe(previousKeys[0]);
    expect(nextKeys[1]).toBe(previousKeys[1]);
    expect(nextKeys[2]).toBe(previousKeys[2]);
  });

  it("replaces a paragraph directly after a heading", () => {
    const previousMarkdown = "# Heading\nSecond paragraph.";
    const nextMarkdown = "# Heading\nSecond changed.";
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result).toMatchObject({
      applied: true,
      blockFrom: previousMarkdown.indexOf("Second"),
      nextBlockSource: "Second changed.",
      nextBlockTo: nextMarkdown.length,
    });
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
  });

  it("replaces the affected line when preserved newlines create sibling paragraphs", () => {
    const previousMarkdown = "First paragraph line.\nSecond paragraph line.";
    const nextMarkdown = "First paragraph line.\nSecond changed line.";
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result).toMatchObject({
      applied: true,
      blockFrom: previousMarkdown.indexOf("Second"),
      nextBlockSource: "Second changed line.",
      nextBlockTo: nextMarkdown.length,
    });
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
  });

  it("updates one affected raw block and leaves sibling blocks intact", () => {
    const previousMarkdown = [
      "::: {.theorem #thm:sample title=\"Sample\"}",
      "Alpha [@thm:main-upper] Beta.",
      "",
      "Second paragraph.",
      ":::",
      "",
      "Tail paragraph.",
    ].join("\n");
    const nextMarkdown = previousMarkdown.replace(" Beta", "123 Beta");
    const expectedNextBlockSource = nextMarkdown.slice(0, nextMarkdown.indexOf("\n\nTail paragraph."));
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, previousMarkdown);
    const previousKeys = readTopLevelKeys(editor);

    const result = applyIncrementalRichDocumentSync(editor, previousMarkdown, nextMarkdown);

    expect(result).toMatchObject({
      applied: true,
      blockFrom: 0,
      nextBlockSource: expectedNextBlockSource,
      nextBlockTo: expectedNextBlockSource.length,
    });
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
    const nextKeys = readTopLevelKeys(editor);
    expect(nextKeys).toHaveLength(previousKeys.length);
    expect(nextKeys[0]).toBe(previousKeys[0]);
    expect(nextKeys.slice(1)).toEqual(previousKeys.slice(1));
  });

  it("updates the edited raw-block occurrence when duplicate raw sources exist", () => {
    const repeatedRawBlock = [
      "::: {.proof}",
      "Repeated body.",
      ":::",
    ].join("\n");
    const previousMarkdown = [
      "::: {#legacy .theorem} Legacy Title",
      "Ignored by the canonical source-block scanner.",
      ":::",
      "",
      repeatedRawBlock,
      "",
      repeatedRawBlock,
    ].join("\n");
    const firstBodyOffset = previousMarkdown.indexOf("Repeated body.") + "Repeated".length;
    const nextMarkdown = [
      previousMarkdown.slice(0, firstBodyOffset),
      "1",
      previousMarkdown.slice(firstBodyOffset),
    ].join("");
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result.applied).toBe(true);
    expect(getLexicalMarkdown(editor)).toBe(nextMarkdown);
  });

  it("falls back when a raw-block body edit can change block boundaries", () => {
    const previousMarkdown = [
      "::: {.proof}",
      "Body text.",
      ":::",
    ].join("\n");
    const insertAt = previousMarkdown.indexOf("\n:::");
    const nextMarkdown = [
      previousMarkdown.slice(0, insertAt),
      "\n:::",
      "\nEscaped paragraph.",
      previousMarkdown.slice(insertAt),
    ].join("");
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result).toEqual({ applied: false });
    expect(getLexicalMarkdown(editor)).toBe(previousMarkdown);
  });

  it("falls back when a change crosses paragraph boundaries", () => {
    const previousMarkdown = "Alpha beta.\n\nSecond paragraph.";
    const nextMarkdown = "Alpha paragraph.";
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result).toEqual({ applied: false });
    expect(getLexicalMarkdown(editor)).toBe(previousMarkdown);
  });

  it("falls back when the replacement would create multiple blocks", () => {
    const previousMarkdown = "Alpha beta.";
    const nextMarkdown = "Alpha one\n\ntwo beta.";
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result).toEqual({ applied: false });
    expect(getLexicalMarkdown(editor)).toBe(previousMarkdown);
  });

  it("falls back for non-paragraph top-level blocks", () => {
    const previousMarkdown = "- Alpha beta";
    const nextMarkdown = "- Alpha gamma";
    const { result, editor } = applyIncrementalChange(previousMarkdown, nextMarkdown);

    expect(result).toEqual({ applied: false });
    expect(getLexicalMarkdown(editor)).toBe(previousMarkdown);
  });
});
