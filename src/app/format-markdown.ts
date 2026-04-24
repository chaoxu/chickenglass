import type { FormatEventDetail } from "../constants/events";
import type { MarkdownEditorSelection } from "../lexical/markdown-editor-types";
import type { EditorDocumentChange } from "../lib/editor-document-diff";
import { getTextLineAtOffset, getTextLines } from "./markdown/text-lines";

interface FormatPlan {
  readonly changes: readonly EditorDocumentChange[];
  readonly selection: { readonly anchor: number; readonly focus: number };
}

function wrapSelection(
  doc: string,
  selection: MarkdownEditorSelection,
  before: string,
  after: string,
): FormatPlan {
  const selectedText = doc.slice(selection.from, selection.to);
  return {
    changes: [{
      from: selection.from,
      to: selection.to,
      insert: `${before}${selectedText}${after}`,
    }],
    selection: selection.from === selection.to
      ? {
        anchor: selection.from + before.length,
        focus: selection.from + before.length,
      }
      : {
        anchor: selection.from + before.length,
        focus: selection.to + before.length,
      },
  };
}

function formatHeading(
  doc: string,
  selection: MarkdownEditorSelection,
  level: number,
): FormatPlan {
  const lines = getTextLines(doc);
  const startLine = getTextLineAtOffset(doc, selection.from);
  const endAnchor = selection.to > selection.from ? selection.to - 1 : selection.to;
  const endLine = getTextLineAtOffset(doc, endAnchor);
  const prefix = `${"#".repeat(level)} `;
  const changes: EditorDocumentChange[] = [];
  let firstDelta = 0;

  for (let index = startLine.number - 1; index < endLine.number; index += 1) {
    const line = lines[index];
    const existing = line.text.match(/^(#{1,6})[ \t]+/);
    const from = line.start;
    const to = existing ? line.start + existing[0].length : line.start;
    if (index === startLine.number - 1) {
      firstDelta = prefix.length - (to - from);
    }
    changes.push({ from, to, insert: prefix });
  }

  return {
    changes,
    selection: {
      anchor: Math.max(startLine.start + prefix.length, selection.anchor + firstDelta),
      focus: Math.max(startLine.start + prefix.length, selection.focus + firstDelta),
    },
  };
}

function formatLink(
  doc: string,
  selection: MarkdownEditorSelection,
): FormatPlan {
  const selectedText = doc.slice(selection.from, selection.to) || "link";
  const insert = `[${selectedText}](https://)`;
  const urlStart = selection.from + selectedText.length + 3;
  return {
    changes: [{
      from: selection.from,
      to: selection.to,
      insert,
    }],
    selection: {
      anchor: urlStart,
      focus: urlStart + "https://".length,
    },
  };
}

export function planMarkdownFormat(
  doc: string,
  selection: MarkdownEditorSelection,
  detail: FormatEventDetail,
): FormatPlan {
  switch (detail.type) {
    case "bold":
      return wrapSelection(doc, selection, "**", "**");
    case "italic":
      return wrapSelection(doc, selection, "*", "*");
    case "code":
      return wrapSelection(doc, selection, "`", "`");
    case "strikethrough":
      return wrapSelection(doc, selection, "~~", "~~");
    case "highlight":
      return wrapSelection(doc, selection, "==", "==");
    case "link":
      return formatLink(doc, selection);
    case "heading":
      return formatHeading(doc, selection, detail.level);
  }
}
