import { useCallback } from "react";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";

import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { collectSourceBlockRanges } from "./markdown/block-scanner";
import type { ParsedFencedDivBlock } from "./markdown/block-syntax";
import { getLexicalMarkdown } from "./markdown";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import {
  getMarkdownVisibleTextLength,
  mapVisibleTextSelectionToMarkdown,
} from "./source-selection";
import { readSourcePositionFromElement } from "./source-position-plugin";
import { SET_SOURCE_SELECTION_COMMAND } from "./source-selection-command";

export type StructureSourceSelectionMapper = (
  selection: MarkdownEditorSelection,
) => MarkdownEditorSelection | number | null;

function firstLineLength(raw: string): number {
  const firstNewline = raw.indexOf("\n");
  return firstNewline < 0 ? raw.length : firstNewline;
}

export function fencedDivBodyMarkdownOffset(raw: string): number {
  const firstLength = firstLineLength(raw);
  return firstLength >= raw.length ? raw.length : firstLength + 1;
}

export function fencedDivTrimmedBodyMarkdownOffset(raw: string): number {
  const bodyStart = fencedDivBodyMarkdownOffset(raw);
  const bodyEnd = raw.lastIndexOf("\n");
  const bodyMarkdown = raw.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : raw.length);
  return bodyStart + bodyMarkdown.length - bodyMarkdown.trimStart().length;
}

export function fencedDivTitleMarkdownOffset(
  raw: string,
  parsed: ParsedFencedDivBlock,
): number | null {
  const title = parsed.titleMarkdown;
  if (!title) {
    return null;
  }

  const opener = raw.slice(0, firstLineLength(raw));
  const fenceMatch = opener.match(/^\s*:{3,}/);
  if (!fenceMatch) {
    return null;
  }

  const headerPadding = opener.slice(fenceMatch[0].length).match(/^\s*/)?.[0].length ?? 0;
  const headerOffset = fenceMatch[0].length + headerPadding;
  const header = opener.slice(headerOffset);

  if (parsed.titleKind === "implicit") {
    return headerOffset;
  }

  if (parsed.titleKind === "trailing") {
    const attrsEnd = header.indexOf("}");
    const trailingRawOffset = attrsEnd >= 0 ? attrsEnd + 1 : 0;
    const leading = header.slice(trailingRawOffset).match(/^\s*/)?.[0].length ?? 0;
    return headerOffset + trailingRawOffset + leading;
  }

  if (parsed.titleKind === "attribute") {
    const match = header.match(/\btitle=(?:"([^"]*)"|'([^']*)')/);
    if (!match || match.index === undefined) {
      return null;
    }
    const quoteOffset = match[0].startsWith("title=\"") ? "title=\"".length : "title='".length;
    return headerOffset + match.index + quoteOffset;
  }

  return null;
}

export function footnoteDefinitionBodyOffset(raw: string): number {
  const opener = raw.slice(0, firstLineLength(raw));
  return opener.match(/^\[\^[^\]]+\]:\s*/)?.[0].length ?? 0;
}

function mapSelectionIntoRaw(
  offsetInRaw: number | StructureSourceSelectionMapper,
  selection: MarkdownEditorSelection,
): MarkdownEditorSelection | null {
  if (typeof offsetInRaw === "function") {
    const mapped = offsetInRaw(selection);
    if (mapped === null) {
      return null;
    }
    if (typeof mapped === "number") {
      return {
        anchor: mapped,
        focus: mapped,
        from: mapped,
        to: mapped,
      };
    }
    return mapped;
  }

  const anchor = offsetInRaw + selection.anchor;
  const focus = offsetInRaw + selection.focus;
  return {
    anchor,
    focus,
    from: Math.min(anchor, focus),
    to: Math.max(anchor, focus),
  };
}

function embeddedMarkdownFieldSelectionMapper(
  markdown: string,
  offsetInRaw: number,
): StructureSourceSelectionMapper {
  return (selection) => {
    const visibleLength = getMarkdownVisibleTextLength(markdown);
    const mapped = selection.to <= visibleLength
      ? mapVisibleTextSelectionToMarkdown(markdown, selection)
      : null;
    const sourceSelection = mapped ?? selection;
    const anchor = offsetInRaw + sourceSelection.anchor;
    const focus = offsetInRaw + sourceSelection.focus;
    return {
      anchor,
      focus,
      from: Math.min(anchor, focus),
      to: Math.max(anchor, focus),
    };
  };
}

function mapEmbeddedMarkdownFieldSelection(
  selection: MarkdownEditorSelection,
  markdown: string,
  offsetInRaw: number,
): MarkdownEditorSelection {
  return embeddedMarkdownFieldSelectionMapper(markdown, offsetInRaw)(selection) as MarkdownEditorSelection;
}

function readRawBlockSourcePosition(
  editor: LexicalEditor,
  nodeKey: NodeKey,
): number | null {
  const raw = editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    return $isRawBlockNode(node) ? node.getRaw() : null;
  });
  if (!raw) {
    return null;
  }

  const markdown = getLexicalMarkdown(editor);
  const matchingRanges = collectSourceBlockRanges(markdown).filter((range) => range.raw === raw);
  if (matchingRanges.length === 1) {
    return matchingRanges[0].from;
  }

  const directIndex = markdown.indexOf(raw);
  return directIndex >= 0 ? directIndex : null;
}

function readStructureBlockPosition(editor: LexicalEditor, nodeKey: NodeKey): number | null {
  return readRawBlockSourcePosition(editor, nodeKey)
    ?? readSourcePositionFromElement(editor.getElementByKey(nodeKey));
}

export function useEmbeddedMarkdownSourceSelectionBridge(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  offsetInRaw: number,
): (selection: MarkdownEditorSelection, markdown: string) => void {
  return useCallback((selection: MarkdownEditorSelection, markdown: string) => {
    const blockPosition = readStructureBlockPosition(editor, nodeKey);
    if (blockPosition === null) {
      return;
    }
    const rawSelection = mapEmbeddedMarkdownFieldSelection(selection, markdown, offsetInRaw);
    editor.dispatchCommand(
      SET_SOURCE_SELECTION_COMMAND,
      {
        anchor: blockPosition + rawSelection.anchor,
        focus: blockPosition + rawSelection.focus,
      },
    );
  }, [editor, nodeKey, offsetInRaw]);
}

export function useStructureSourceSelectionBridge(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  offsetInRaw: number | StructureSourceSelectionMapper = 0,
): (selection: MarkdownEditorSelection) => void {
  return useCallback((selection: MarkdownEditorSelection) => {
    const blockPosition = readStructureBlockPosition(editor, nodeKey);
    if (blockPosition === null) {
      return;
    }
    const rawSelection = mapSelectionIntoRaw(offsetInRaw, selection);
    if (rawSelection === null) {
      return;
    }
    editor.dispatchCommand(
      SET_SOURCE_SELECTION_COMMAND,
      {
        anchor: blockPosition + rawSelection.anchor,
        focus: blockPosition + rawSelection.focus,
      },
    );
  }, [editor, nodeKey, offsetInRaw]);
}
