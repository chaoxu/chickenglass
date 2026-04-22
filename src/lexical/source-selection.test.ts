import { $getRoot, COMMAND_PRIORITY_LOW } from "lexical";
import { describe, expect, it } from "vitest";

import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import { applyIncrementalRichDocumentSync } from "./incremental-rich-sync";
import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import {
  ACTIVATE_STRUCTURE_EDIT_COMMAND,
  type ActivateStructureEditRequest,
} from "./structure-edit-plugin";
import {
  mapVisibleTextSelectionToMarkdown,
  readSourceSelectionFromLexicalSelection,
  selectSourceOffsetsInRichLexicalNode,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-selection";

function findTopLevelKeyContaining(
  editor: ReturnType<typeof createHeadlessCoflatEditor>,
  text: string,
): string {
  return editor.getEditorState().read(() => {
    const node = [...$getRoot().getChildren()].reverse().find((child) =>
      child.getTextContent().includes(text)
    );
    if (!node) {
      throw new Error(`Expected a top-level node containing ${text}`);
    }
    return node.getKey();
  });
}

function findLineAnchor(doc: string, needle: string): number {
  const lineStart = doc.indexOf(needle);
  if (lineStart < 0) {
    throw new Error(`Expected fixture line containing ${needle}`);
  }
  const firstLetter = needle.search(/[A-Za-z]/);
  const base = firstLetter >= 0 ? firstLetter : 0;
  return lineStart + Math.min(base + 8, Math.max(needle.length - 1, 0));
}

describe("source selection mapping", () => {
  it("restores a local selection after an incremental prose sync", () => {
    const previousDoc = [
      "Intro paragraph.",
      "",
      "Finally, [@lem:homogeneous-lambdak] gives $\\lambda_k^*(M)=kn/r$, and therefore $\\lambda_k(M)\\le d\\,\\lambda_k^*(M)$. This completes the induction.",
    ].join("\n");
    const anchor = previousDoc.indexOf("Finally") + "Finally".length;
    const nextDoc = [
      previousDoc.slice(0, anchor),
      "111",
      previousDoc.slice(anchor),
    ].join("");
    const nextAnchor = anchor + 3;
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, previousDoc);

    const result = applyIncrementalRichDocumentSync(editor, previousDoc, nextDoc);

    expect(result.applied).toBe(true);
    if (!result.applied) {
      return;
    }
    expect(selectSourceOffsetsInRichLexicalNode(
      editor,
      result.nodeKey,
      result.nextBlockSource,
      result.blockFrom,
      nextAnchor,
    )).toBe(true);
    expect(readSourceSelectionFromLexicalSelection(editor, { markdown: nextDoc })).toEqual({
      anchor: nextAnchor,
      focus: nextAnchor,
      from: nextAnchor,
      to: nextAnchor,
    });
  });

  it("restores a local source reveal after an incremental reference sync", () => {
    const previousDoc = [
      "Intro paragraph.",
      "",
      "If $G$ is $k$-edge-connected with $m = O(kn)$ edges, then $\\cg(G) = O(k)$ and the bound in [@thm:main-upper] is tight up to constant factors.",
    ].join("\n");
    const anchor = previousDoc.indexOf("thm:main-upper") + "thm".length;
    const nextDoc = [
      previousDoc.slice(0, anchor),
      "111",
      previousDoc.slice(anchor),
    ].join("");
    const nextAnchor = anchor + 3;
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, previousDoc);
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
      const result = applyIncrementalRichDocumentSync(editor, previousDoc, nextDoc);
      expect(result.applied).toBe(true);
      if (!result.applied) {
        return;
      }
      expect(selectSourceOffsetsInRichLexicalNode(
        editor,
        result.nodeKey,
        result.nextBlockSource,
        result.blockFrom,
        nextAnchor,
      )).toBe(true);
      expect(request).toMatchObject({
        adapterId: "reference",
        caretOffset: nextAnchor - nextDoc.indexOf("[@thm111:main-upper]"),
        source: "[@thm111:main-upper]",
      });
    } finally {
      unregister();
    }
  });

  it("restores local selections for heavy-fixture incremental sync hotspots", () => {
    const cases = [
      {
        name: "canonical raw block after legacy raw block index drift",
        doc: [
          "::: {#legacy .theorem} Legacy Title",
          "A legacy titled block that the source-block scanner intentionally ignores.",
          ":::",
          "",
          "::: {.proof}",
          "Finally, [@lem:homogeneous-lambdak] gives $\\lambda_k^*(M)=kn/r$, and therefore $\\lambda_k(M)\\le d\\,\\lambda_k^*(M)$. This completes the induction.",
          ":::",
        ].join("\n"),
        anchor: (doc: string) => findLineAnchor(
          doc,
          "Finally, [@lem:homogeneous-lambdak] gives $\\lambda_k^*(M)=kn/r$, and therefore $\\lambda_k(M)\\le d\\,\\lambda_k^*(M)$. This completes the induction.",
        ),
      },
      {
        name: "preserved-newline paragraph after legacy raw block index drift",
        doc: [
          "::: {#def:open-problems .definition} Open Problems",
          "1. Dynamic co-girth: maintain cuts under updates.",
          ":::",
          "",
          "For weighted instances, the combination of Karger's randomized algorithm with the structural decomposition [@thm:structure] yields practical algorithms.",
          "Further engineering of these algorithms, guided by the theoretical bounds developed here, is an active area of research.",
        ].join("\n"),
        anchor: (doc: string) => findLineAnchor(
          doc,
          "Further engineering of these algorithms, guided by the theoretical bounds developed here, is an active area of research.",
        ),
      },
      {
        name: "reference inside legacy titled raw block",
        doc: [
          "::: {#cor:sparse-graphs .corollary} Sparse Graph Bound",
          "If $G$ is $k$-edge-connected with $m = O(kn)$ edges, then $\\cg(G) = O(k)$ and the bound in [@thm:main-upper] is tight up to constant factors.",
          ":::",
        ].join("\n"),
        anchor: (doc: string) => doc.indexOf("[@thm:main-upper]") + "[@thm".length,
      },
    ];

    for (const testCase of cases) {
      const previousDoc = testCase.doc;
      const anchor = testCase.anchor(previousDoc);
      const insert = "1".repeat(100);
      const nextDoc = [
        previousDoc.slice(0, anchor),
        insert,
        previousDoc.slice(anchor),
      ].join("");
      const nextAnchor = anchor + insert.length;
      const editor = createHeadlessCoflatEditor();
      setLexicalMarkdown(editor, previousDoc);

      const result = applyIncrementalRichDocumentSync(editor, previousDoc, nextDoc);

      expect(result.applied, testCase.name).toBe(true);
      if (!result.applied) {
        continue;
      }
      expect(selectSourceOffsetsInRichLexicalNode(
        editor,
        result.nodeKey,
        result.nextBlockSource,
        result.blockFrom,
        nextAnchor,
      )).toBe(true);
    }
  });

  it("selects duplicated text through a local node source span", () => {
    const doc = "same alpha\n\nsame beta";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    const sourceOffset = doc.lastIndexOf("same");
    const nodeKey = findTopLevelKeyContaining(editor, "same beta");
    const target = sourceOffset + 2;

    expect(selectSourceOffsetsInRichLexicalNode(
      editor,
      nodeKey,
      doc.slice(sourceOffset),
      sourceOffset,
      target,
    )).toBe(true);
    expect(readSourceSelectionFromLexicalSelection(editor, { markdown: doc })).toEqual({
      anchor: target,
      focus: target,
      from: target,
      to: target,
    });
  });

  it("opens link source reveal through a local node source span", () => {
    const doc = "[same](https://one.example)\n\n[same](https://two.example)";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    const sourceOffset = doc.lastIndexOf("[same]");
    const nodeKey = findTopLevelKeyContaining(editor, "same");
    const offset = doc.indexOf("two.example") + 2;
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
      expect(selectSourceOffsetsInRichLexicalNode(
        editor,
        nodeKey,
        doc.slice(sourceOffset),
        sourceOffset,
        offset,
      )).toBe(true);
      expect(request).toMatchObject({
        adapterId: "link",
        caretOffset: offset - sourceOffset,
        source: "[same](https://two.example)",
      });
    } finally {
      unregister();
    }
  });

  it("opens legacy raw-block source through a local node source span", () => {
    const doc = [
      "::: {#cor:sparse-graphs .corollary} Sparse Graph Bound",
      "The bound in [@thm:main-upper] is tight.",
      ":::",
    ].join("\n");
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    const nodeKey = findTopLevelKeyContaining(editor, "Sparse Graph Bound");
    const offset = doc.indexOf("thm:main-upper") + "thm".length;

    expect(selectSourceOffsetsInRichLexicalNode(
      editor,
      nodeKey,
      doc,
      0,
      offset,
    )).toBe(true);
  });

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

  it("does not reveal raw blocks when raw source reveals are disabled", () => {
    const doc = ["---", "title: Test", "---", "", "# Intro"].join("\n");
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    let request: CursorRevealOpenRequest | null = null;
    let structureRequest: ActivateStructureEditRequest | null = null;
    const unregister = editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (nextRequest) => {
        request = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterStructure = editor.registerCommand(
      ACTIVATE_STRUCTURE_EDIT_COMMAND,
      (nextRequest) => {
        structureRequest = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    try {
      expect(selectSourceOffsetsInRichLexicalRoot(editor, doc, 0, 0, {
        revealRawBlockAtBoundary: false,
        revealRawBlocks: false,
      })).toBe(false);
      expect(request).toBeNull();
      expect(structureRequest).toBeNull();
    } finally {
      unregister();
      unregisterStructure();
    }
  });

  it("routes footnote-definition label offsets to the structure source editor", () => {
    const doc = "[^note]: Footnote body.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    let revealRequest: CursorRevealOpenRequest | null = null;
    let structureRequest: ActivateStructureEditRequest | null = null;
    const unregisterReveal = editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (nextRequest) => {
        revealRequest = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterStructure = editor.registerCommand(
      ACTIVATE_STRUCTURE_EDIT_COMMAND,
      (nextRequest) => {
        structureRequest = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    try {
      expect(selectSourceOffsetsInRichLexicalRoot(editor, doc, doc.indexOf("note") + 1, undefined, {
        revealRawBlockAtBoundary: false,
        revealRawBlocks: false,
      })).toBe(true);
      expect(revealRequest).toBeNull();
      expect(structureRequest).toMatchObject({
        surface: "footnote-source",
        variant: "footnote-definition",
      });
    } finally {
      unregisterReveal();
      unregisterStructure();
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
