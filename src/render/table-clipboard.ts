import { EditorView } from "@codemirror/view";

import {
  findTableAtCursor,
  findTablesInState,
} from "./table-discovery";

function handleCopy(event: ClipboardEvent, view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const pos = view.state.selection.main.head;
  if (!findTableAtCursor(tables, pos)) return false;

  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  let text = view.state.sliceDoc(from, to);
  text = text.replace(/(?<!\\)\|/g, "");
  text = text.replace(/ {2,}/g, " ").trim();

  event.clipboardData?.setData("text/plain", text);
  event.preventDefault();
  return true;
}

function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const pos = view.state.selection.main.head;
  if (!findTableAtCursor(tables, pos)) return false;

  const raw = event.clipboardData?.getData("text/plain");
  if (!raw) return false;

  const text = raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>{1,}\s*/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^:::.*/, "")
        .replace(/^```.*$/, ""),
    )
    .join(" ")
    .replace(/\|/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text) view.dispatch(view.state.replaceSelection(text));
  event.preventDefault();
  return true;
}

export const tableClipboardHandlers = EditorView.domEventHandlers({
  copy(event, view) {
    return handleCopy(event, view);
  },
  cut(event, view) {
    if (handleCopy(event, view)) {
      view.dispatch(view.state.replaceSelection(""));
      return true;
    }
    return false;
  },
  paste(event, view) {
    return handlePaste(event, view);
  },
});
