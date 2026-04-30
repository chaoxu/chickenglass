import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorView } from "@codemirror/view";

const INDENT_UNIT = "  ";

function findListItemAtCursor(view: EditorView): SyntaxNode | null {
  const pos = view.state.selection.main.head;
  const tree = syntaxTree(view.state);
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);

  while (node) {
    if (node.name === "ListItem") {
      return node;
    }
    node = node.parent;
  }
  return null;
}

function lineIndent(lineText: string): number {
  const match = lineText.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

interface ListMarkerInfo {
  readonly indent: string;
  readonly marker: string;
  readonly contentStart: number;
  readonly orderedNumber?: number;
  readonly orderedDelimiter?: "." | ")";
}

function parseOrderedMarker(
  marker: string,
): { number: number; delimiter: "." | ")" } | null {
  const delimiter = marker.at(-1);
  if (delimiter !== "." && delimiter !== ")") return null;

  const digits = marker.slice(0, -1);
  if (digits.length === 0) return null;
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    if (code < 48 || code > 57) return null;
  }

  return {
    number: Number(digits),
    delimiter,
  };
}

function getListMarkerInfo(
  doc: EditorView["state"]["doc"],
  listItem: SyntaxNode,
  line = doc.lineAt(listItem.from),
): ListMarkerInfo | null {
  const itemLine = doc.lineAt(listItem.from);
  if (itemLine.from !== line.from) {
    return null;
  }

  const listMark = listItem.getChild("ListMark");
  if (!listMark) return null;

  const indent = doc.sliceString(itemLine.from, listMark.from);
  const marker = doc.sliceString(listMark.from, listMark.to);
  let contentStart = listMark.to;
  if (contentStart < line.to && doc.sliceString(contentStart, contentStart + 1) === " ") {
    contentStart += 1;
  }

  const ordered = parseOrderedMarker(marker);

  return {
    indent,
    marker,
    contentStart,
    orderedNumber: ordered?.number,
    orderedDelimiter: ordered?.delimiter,
  };
}

function emptyListMarkerLineContentStart(lineText: string): number | null {
  const match = /^(\s*)(?:[-+*]|\d+[.)])\s*$/.exec(lineText);
  return match ? lineText.length : null;
}

function exitEmptyListMarkerLine(view: EditorView): boolean {
  const cursorPos = view.state.selection.main.head;
  if (!view.state.selection.main.empty) return false;

  const line = view.state.doc.lineAt(cursorPos);
  const contentStart = emptyListMarkerLineContentStart(line.text);
  if (contentStart === null) return false;
  if (cursorPos !== line.from + contentStart) return false;

  view.dispatch({
    changes: { from: line.from, to: line.to },
    selection: { anchor: line.from },
  });
  return true;
}

function findParentListItem(node: SyntaxNode): SyntaxNode | null {
  const parentList = node.parent;
  if (!parentList) return null;
  const grandparent = parentList.parent;
  if (!grandparent || grandparent.name !== "ListItem") return null;
  return grandparent;
}

function findPrevSibling(node: SyntaxNode): SyntaxNode | null {
  let prev = node.prevSibling;
  while (prev) {
    if (prev.name === "ListItem") return prev;
    prev = prev.prevSibling;
  }
  return null;
}

function findNextSibling(node: SyntaxNode): SyntaxNode | null {
  let next = node.nextSibling;
  while (next) {
    if (next.name === "ListItem") return next;
    next = next.nextSibling;
  }
  return null;
}

export function indentListItem(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;
  if (!findPrevSibling(listItem)) return false;

  const doc = view.state.doc;
  const startLine = doc.lineAt(listItem.from);
  const endLine = doc.lineAt(listItem.to);

  const changes: { from: number; insert: string }[] = [];
  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = doc.line(lineNum);
    if (line.length > 0) {
      changes.push({ from: line.from, insert: INDENT_UNIT });
    }
  }

  if (changes.length === 0) return false;

  view.dispatch({
    changes,
    selection: {
      anchor: view.state.selection.main.anchor + INDENT_UNIT.length,
    },
  });

  return true;
}

function removeListMarkerFromCurrentLine(
  view: EditorView,
  listItem: SyntaxNode,
): boolean {
  const doc = view.state.doc;
  const cursorPos = view.state.selection.main.head;
  const line = doc.lineAt(cursorPos);
  const markerInfo = getListMarkerInfo(doc, listItem, line);
  if (!markerInfo) return false;

  view.dispatch({
    changes: { from: line.from, to: markerInfo.contentStart },
    selection: {
      anchor: Math.max(line.from, cursorPos - (markerInfo.contentStart - line.from)),
    },
  });
  return true;
}

export function outdentListItem(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  if (!findParentListItem(listItem)) {
    return removeListMarkerFromCurrentLine(view, listItem);
  }

  const doc = view.state.doc;
  const startLine = doc.lineAt(listItem.from);
  const endLine = doc.lineAt(listItem.to);

  const indentLen = INDENT_UNIT.length;
  const changes: { from: number; to: number }[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = doc.line(lineNum);
    const indent = lineIndent(line.text);
    if (indent >= indentLen) {
      changes.push({ from: line.from, to: line.from + indentLen });
    }
  }

  if (changes.length === 0) return false;

  const cursorLine = doc.lineAt(view.state.selection.main.head);
  const cursorIndent = lineIndent(cursorLine.text);
  const cursorShift = Math.min(indentLen, cursorIndent);

  view.dispatch({
    changes,
    selection: {
      anchor: view.state.selection.main.anchor - cursorShift,
    },
  });

  return true;
}

export function moveListItemUp(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const prevItem = findPrevSibling(listItem);
  if (!prevItem) return false;

  const doc = view.state.doc;
  const cursorOffset = view.state.selection.main.head - listItem.from;
  const prevText = doc.sliceString(prevItem.from, prevItem.to);
  const currText = doc.sliceString(listItem.from, listItem.to);
  const separator = doc.sliceString(prevItem.to, listItem.from);

  view.dispatch({
    changes: {
      from: prevItem.from,
      to: listItem.to,
      insert: currText + separator + prevText,
    },
    selection: { anchor: prevItem.from + cursorOffset },
  });

  return true;
}

export function moveListItemDown(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const nextItem = findNextSibling(listItem);
  if (!nextItem) return false;

  const doc = view.state.doc;
  const cursorOffset = view.state.selection.main.head - listItem.from;
  const currText = doc.sliceString(listItem.from, listItem.to);
  const nextText = doc.sliceString(nextItem.from, nextItem.to);
  const separator = doc.sliceString(listItem.to, nextItem.from);

  view.dispatch({
    changes: {
      from: listItem.from,
      to: nextItem.to,
      insert: nextText + separator + currText,
    },
    selection: { anchor: listItem.from + nextText.length + separator.length + cursorOffset },
  });

  return true;
}

export function enterInListItem(view: EditorView): boolean {
  if (exitEmptyListMarkerLine(view)) return true;

  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const state = view.state;
  const doc = state.doc;
  const cursorPos = state.selection.main.head;
  const line = doc.lineAt(cursorPos);
  const lineText = line.text;

  const markerInfo = getListMarkerInfo(doc, listItem, line);
  if (!markerInfo) return false;

  const contentAfterMarker = lineText.slice(markerInfo.contentStart - line.from).trim();

  if (contentAfterMarker.length === 0) {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: { anchor: line.from },
    });
    return true;
  }

  const textAfterCursor = doc.sliceString(cursorPos, line.to);
  const newMarker = (
    markerInfo.orderedNumber !== undefined &&
    markerInfo.orderedDelimiter !== undefined
  )
    ? `${markerInfo.indent}${markerInfo.orderedNumber + 1}${markerInfo.orderedDelimiter} `
    : `${markerInfo.indent}${markerInfo.marker} `;

  view.dispatch({
    changes: { from: cursorPos, to: line.to, insert: `\n${newMarker}${textAfterCursor}` },
    selection: { anchor: cursorPos + 1 + newMarker.length },
  });

  return true;
}

export function backspaceAtListItemStart(view: EditorView): boolean {
  if (exitEmptyListMarkerLine(view)) return true;

  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const state = view.state;
  const doc = state.doc;
  const cursorPos = state.selection.main.head;

  if (!state.selection.main.empty) return false;

  const line = doc.lineAt(cursorPos);
  const lineText = line.text;

  const markerInfo = getListMarkerInfo(doc, listItem, line);
  if (!markerInfo) return false;
  const contentStart = markerInfo.contentStart;

  if (cursorPos !== contentStart) return false;

  const currentContent = lineText.slice(contentStart - line.from);
  if (currentContent.trim().length === 0) {
    return removeListMarkerFromCurrentLine(view, listItem);
  }

  const prevItem = findPrevSibling(listItem);
  if (!prevItem) return false;

  const prevLine = doc.lineAt(prevItem.from);
  const deleteFrom = line.from;
  const deleteTo = line.number < doc.lines ? doc.line(line.number + 1).from : line.to;

  view.dispatch({
    changes: [
      { from: prevLine.to, insert: currentContent },
      { from: deleteFrom, to: deleteTo },
    ],
    selection: { anchor: prevLine.to + currentContent.length },
  });

  return true;
}
