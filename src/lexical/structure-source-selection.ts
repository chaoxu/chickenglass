import { useCallback } from "react";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";

import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { getLexicalMarkdown } from "./markdown";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import {
  fencedDivBodyMarkdownOffset,
  fencedDivTitleMarkdownOffset,
  fencedDivTrimmedBodyMarkdownOffset,
  footnoteDefinitionBodyOffsetToRawOffset,
  footnoteDefinitionBodyOffset,
} from "./structure-source-offsets";
import {
  getMarkdownVisibleTextLength,
  mapVisibleTextSelectionToMarkdown,
} from "./source-selection";
import { readSourcePositionFromElement } from "./source-position-plugin";
import { createSourceSpanIndex } from "./source-spans";
import { SET_SOURCE_SELECTION_COMMAND } from "./source-selection-command";

export type StructureSourceSelectionMapper = (
  selection: MarkdownEditorSelection,
) => MarkdownEditorSelection | number | null;

export {
  fencedDivBodyMarkdownOffset,
  fencedDivTitleMarkdownOffset,
  fencedDivTrimmedBodyMarkdownOffset,
  footnoteDefinitionBodyOffset,
  footnoteDefinitionBodyOffsetToRawOffset,
};

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
  offsetInRaw: number | StructureSourceSelectionMapper,
): StructureSourceSelectionMapper {
  return (selection) => {
    if (typeof offsetInRaw === "function") {
      return offsetInRaw(selection);
    }
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
  offsetInRaw: number | StructureSourceSelectionMapper,
): MarkdownEditorSelection {
  return embeddedMarkdownFieldSelectionMapper(markdown, offsetInRaw)(selection) as MarkdownEditorSelection;
}

export function footnoteDefinitionBodySelectionMapper(raw: string): StructureSourceSelectionMapper {
  return (selection) => {
    const anchor = footnoteDefinitionBodyOffsetToRawOffset(raw, selection.anchor);
    const focus = footnoteDefinitionBodyOffsetToRawOffset(raw, selection.focus);
    return {
      anchor,
      focus,
      from: Math.min(anchor, focus),
      to: Math.max(anchor, focus),
    };
  };
}

export function readRawBlockSourcePosition(
  editor: LexicalEditor,
  nodeKey: NodeKey,
): number | null {
  const markdown = getLexicalMarkdown(editor);
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    if (!$isRawBlockNode(node)) {
      return null;
    }
    return createSourceSpanIndex(markdown).getNodeStart(node);
  });
}

function readStructureBlockPosition(editor: LexicalEditor, nodeKey: NodeKey): number | null {
  return readSourcePositionFromElement(editor.getElementByKey(nodeKey))
    ?? readRawBlockSourcePosition(editor, nodeKey);
}

export function useEmbeddedMarkdownSourceSelectionBridge(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  offsetInRaw: number | StructureSourceSelectionMapper,
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
