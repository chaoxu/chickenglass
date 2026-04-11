import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type PointType,
  type RangeSelection,
} from "lexical";

import type { MarkdownEditorSelection } from "./markdown-editor-types";

interface SourceTextPoint {
  readonly key: string;
  readonly offset: number;
  readonly type: "element" | "text";
}

function getParagraphs(): ElementNode[] {
  return $getRoot().getChildren().filter($isElementNode);
}

export function readSourceTextFromLexicalRoot(): string {
  return getParagraphs().map((paragraph) => paragraph.getTextContent()).join("\n");
}

export function writeSourceTextToLexicalRoot(text: string): void {
  const root = $getRoot();
  root.clear();

  for (const line of text.split("\n")) {
    const paragraph = $createParagraphNode();
    if (line.length > 0) {
      paragraph.append($createTextNode(line));
    }
    root.append(paragraph);
  }
}

function paragraphStartOffset(paragraphIndex: number, paragraphs: readonly ElementNode[]): number {
  let offset = 0;
  for (let index = 0; index < paragraphIndex; index += 1) {
    offset += paragraphs[index].getTextContent().length + 1;
  }
  return offset;
}

function resolvePointAtOffset(offset: number): SourceTextPoint {
  const paragraphs = getParagraphs();
  if (paragraphs.length === 0) {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    return {
      key: paragraph.getKey(),
      offset: 0,
      type: "element",
    };
  }

  let remaining = Math.max(0, offset);
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const textLength = paragraph.getTextContent().length;
    const isLastParagraph = index === paragraphs.length - 1;
    const paragraphSpan = textLength + (isLastParagraph ? 0 : 1);

    if (remaining > paragraphSpan) {
      remaining -= paragraphSpan;
      continue;
    }

    if (remaining > textLength && !isLastParagraph) {
      const nextParagraph = paragraphs[index + 1];
      const nextTextNode = nextParagraph.getAllTextNodes()[0];
      if (nextTextNode) {
        return {
          key: nextTextNode.getKey(),
          offset: 0,
          type: "text",
        };
      }
      return {
        key: nextParagraph.getKey(),
        offset: 0,
        type: "element",
      };
    }

    const textNodes = paragraph.getAllTextNodes();
    if (textNodes.length === 0) {
      return {
        key: paragraph.getKey(),
        offset: 0,
        type: "element",
      };
    }

    let textOffset = remaining;
    for (const textNode of textNodes) {
      const nodeLength = textNode.getTextContent().length;
      if (textOffset <= nodeLength) {
        return {
          key: textNode.getKey(),
          offset: textOffset,
          type: "text",
        };
      }
      textOffset -= nodeLength;
    }

    const lastNode = textNodes[textNodes.length - 1];
    return {
      key: lastNode.getKey(),
      offset: lastNode.getTextContent().length,
      type: "text",
    };
  }

  const lastParagraph = paragraphs[paragraphs.length - 1];
  const lastTextNode = lastParagraph.getAllTextNodes().at(-1);
  if (lastTextNode) {
    return {
      key: lastTextNode.getKey(),
      offset: lastTextNode.getTextContent().length,
      type: "text",
    };
  }

  return {
    key: lastParagraph.getKey(),
    offset: lastParagraph.getChildrenSize(),
    type: "element",
  };
}

function applySelection(selection: RangeSelection, anchor: SourceTextPoint, focus: SourceTextPoint): void {
  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);
  $setSelection(selection);
}

function childTextOffset(node: ElementNode, childOffset: number): number {
  const children = node.getChildren();
  let offset = 0;
  for (let index = 0; index < Math.min(childOffset, children.length); index += 1) {
    offset += children[index].getTextContent().length;
  }
  return offset;
}

function resolvePointOffset(point: PointType): number {
  const root = $getRoot();
  const node = point.getNode();
  const paragraphs = getParagraphs();

  if (node.getKey() === root.getKey()) {
    const paragraphIndex = Math.max(0, Math.min(point.offset, paragraphs.length));
    return paragraphStartOffset(paragraphIndex, paragraphs);
  }

  const paragraph = node.getTopLevelElementOrThrow();
  const paragraphIndex = paragraphs.findIndex((entry) => entry.getKey() === paragraph.getKey());
  const baseOffset = paragraphIndex >= 0 ? paragraphStartOffset(paragraphIndex, paragraphs) : 0;

  if (point.type === "element") {
    if ($isElementNode(node) && node.getKey() === paragraph.getKey()) {
      return baseOffset + childTextOffset(node, point.offset);
    }
    return baseOffset + Math.min(point.offset, paragraph.getTextContent().length);
  }

  let localOffset = 0;
  for (const textNode of paragraph.getAllTextNodes()) {
    if (textNode.getKey() === point.key) {
      return baseOffset + localOffset + point.offset;
    }
    localOffset += textNode.getTextContent().length;
  }

  return baseOffset + paragraph.getTextContent().length;
}

export function readSourceTextSelectionFromLexicalRoot(): MarkdownEditorSelection {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return {
      anchor: 0,
      focus: 0,
      from: 0,
      to: 0,
    };
  }

  const anchor = resolvePointOffset(selection.anchor);
  const focus = resolvePointOffset(selection.focus);
  return {
    anchor,
    focus,
    from: Math.min(anchor, focus),
    to: Math.max(anchor, focus),
  };
}

export function selectSourceOffsetsInLexicalRoot(anchor: number, focus = anchor): void {
  const selection = $createRangeSelection();
  applySelection(selection, resolvePointAtOffset(anchor), resolvePointAtOffset(focus));
}

export function getSourceText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => readSourceTextFromLexicalRoot());
}

export function setSourceText(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    writeSourceTextToLexicalRoot(text);
  }, { discrete: true });
}

export function getSourceTextSelection(editor: LexicalEditor): MarkdownEditorSelection {
  return editor.getEditorState().read(() => readSourceTextSelectionFromLexicalRoot());
}

export function setSourceTextSelection(editor: LexicalEditor, anchor: number, focus = anchor): void {
  editor.update(() => {
    selectSourceOffsetsInLexicalRoot(anchor, focus);
  }, { discrete: true });
}
