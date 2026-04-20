import type { FormatEventDetail } from "../constants/events";
import { getActiveEditor } from "../lexical/active-editor-tracker";
import { FORMAT_MARKDOWN_COMMAND } from "../lexical/editor-format-command";
import type { MarkdownEditorHandle } from "../lexical/markdown-editor-types";
import { planMarkdownFormat } from "./format-markdown";

export interface MarkdownFormatActionDeps {
  readonly editorHandle: MarkdownEditorHandle | null;
  readonly getCurrentDocText: () => string;
}

export function applyMarkdownFormatAction(
  { editorHandle, getCurrentDocText }: MarkdownFormatActionDeps,
  detail: FormatEventDetail,
): boolean {
  const activeEditor = getActiveEditor();
  if (activeEditor?.dispatchCommand(FORMAT_MARKDOWN_COMMAND, detail)) {
    return true;
  }

  if (!editorHandle) {
    return false;
  }

  const plan = planMarkdownFormat(
    getCurrentDocText(),
    editorHandle.getSelection(),
    detail,
  );
  editorHandle.applyChanges(plan.changes);
  editorHandle.setSelection(plan.selection.anchor, plan.selection.focus);
  editorHandle.focus();
  return true;
}
