import type { LexicalEditor } from "lexical";
import { getActiveEditor } from "./active-editor-tracker";
import { collectSourceBlockRanges } from "./markdown/block-scanner";
import type { MarkdownEditorSelection } from "./markdown-editor-types";

export function sameSelection(
  left: MarkdownEditorSelection,
  right: MarkdownEditorSelection,
): boolean {
  return (
    left.anchor === right.anchor
    && left.focus === right.focus
    && left.from === right.from
    && left.to === right.to
  );
}

export function canReadLiveSelectionFromEditor(editor: LexicalEditor): boolean {
  const activeEditor = getActiveEditor();
  return activeEditor === null || activeEditor === editor;
}

export function selectionTouchesFencedDiv(
  doc: string,
  selection: MarkdownEditorSelection,
): boolean {
  return collectSourceBlockRanges(doc).some((range) =>
    range.variant === "fenced-div" &&
    selection.from >= range.from &&
    selection.to <= range.to
  );
}

