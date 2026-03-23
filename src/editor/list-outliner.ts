/**
 * List outliner: fold/unfold, indent/outdent, move, Enter, and Backspace
 * for list items.
 *
 * - Fold: uses CM6 foldService so that ListItems with children
 *   (nested BulletList or OrderedList) can be collapsed.
 * - Indent (Tab): adds 2 spaces to the current list item and all
 *   its children, respecting maximum nesting constraints.
 * - Outdent (Shift-Tab): removes 2 spaces from the current list
 *   item and all its children.
 * - Move up/down (Cmd-Shift-Up/Down): swaps the current list item
 *   (and all its children) with the previous/next sibling.
 * - Enter: creates a new sibling list item, splitting text at cursor.
 *   Removes empty items instead.
 * - Backspace: at the start of a list item's content, merges with
 *   the previous item.
 *
 * Reference: obsidian-outliner plugin (TypeScript, CM6-based).
 */

import { type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import {
  foldService,
  foldGutter,
  syntaxTree,
  codeFolding,
  foldKeymap,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

const INDENT_UNIT = "  "; // 2 spaces per indent level

/**
 * Check whether a ListItem node has children (a nested list).
 * In the Lezer markdown tree, a ListItem that contains a
 * BulletList or OrderedList child has foldable sub-items.
 */
function hasNestedList(node: SyntaxNode): boolean {
  let child = node.firstChild;
  while (child) {
    if (child.name === "BulletList" || child.name === "OrderedList") {
      return true;
    }
    child = child.nextSibling;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fold service
// ---------------------------------------------------------------------------

/**
 * Fold service for list items. A list item is foldable when it has
 * nested children. The fold range starts at the end of the first
 * content line of the item and ends at the end of the ListItem node.
 */
const listFoldService = foldService.of((state, lineStart, _lineEnd) => {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(lineStart, 1);

  // Walk up to find a ListItem that starts on this line
  while (node) {
    if (node.name === "ListItem") {
      break;
    }
    if (node.parent) {
      node = node.parent;
    } else {
      return null;
    }
  }

  if (node.name !== "ListItem") return null;

  // Only fold if this ListItem starts on the queried line
  const itemLine = state.doc.lineAt(node.from);
  if (itemLine.from !== lineStart) return null;

  // Only fold if there is a nested list
  if (!hasNestedList(node)) return null;

  // Fold from end of the first line to end of the ListItem
  const foldFrom = itemLine.to;
  const foldTo = node.to;

  if (foldTo <= foldFrom) return null;

  return { from: foldFrom, to: foldTo };
});

// ---------------------------------------------------------------------------
// Indent / Outdent
// ---------------------------------------------------------------------------

/**
 * Find the ListItem node that the cursor is currently inside.
 * Returns the innermost ListItem containing the cursor position.
 */
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

/**
 * Get the indent level (number of leading spaces) of a document line.
 */
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

/**
 * Find the parent ListItem of the given ListItem node.
 * In the Lezer tree: ListItem -> BulletList/OrderedList -> ListItem (parent).
 */
function findParentListItem(node: SyntaxNode): SyntaxNode | null {
  // ListItem -> parent list (BulletList/OrderedList) -> parent ListItem
  const parentList = node.parent;
  if (!parentList) return null;
  const grandparent = parentList.parent;
  if (!grandparent || grandparent.name !== "ListItem") return null;
  return grandparent;
}

/**
 * Find the previous sibling ListItem. In the Lezer tree,
 * siblings are children of the same BulletList/OrderedList.
 */
function findPrevSibling(node: SyntaxNode): SyntaxNode | null {
  let prev = node.prevSibling;
  while (prev) {
    if (prev.name === "ListItem") return prev;
    prev = prev.prevSibling;
  }
  return null;
}

/**
 * Find the next sibling ListItem. In the Lezer tree,
 * siblings are children of the same BulletList/OrderedList.
 */
function findNextSibling(node: SyntaxNode): SyntaxNode | null {
  let next = node.nextSibling;
  while (next) {
    if (next.name === "ListItem") return next;
    next = next.nextSibling;
  }
  return null;
}

/**
 * Indent the current list item (and its children) by adding INDENT_UNIT
 * to each line. A list item can only be indented if it has a previous
 * sibling (it would become a child of that sibling).
 */
function indentListItem(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  // Must have a previous sibling to indent under
  if (!findPrevSibling(listItem)) return false;

  // Collect all lines spanned by this list item
  const doc = view.state.doc;
  const startLine = doc.lineAt(listItem.from);
  const endLine = doc.lineAt(listItem.to);

  const changes: { from: number; insert: string }[] = [];
  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = doc.line(lineNum);
    // Only indent non-empty lines
    if (line.length > 0) {
      changes.push({ from: line.from, insert: INDENT_UNIT });
    }
  }

  if (changes.length === 0) return false;

  view.dispatch({
    changes,
    // Keep cursor at the same relative position, shifted by indent
    selection: {
      anchor: view.state.selection.main.anchor + INDENT_UNIT.length,
    },
  });

  return true;
}

/**
 * Outdent the current list item (and its children) by removing
 * INDENT_UNIT from each line. The item must have a parent list item
 * (i.e., it's a nested item) to be outdented.
 */
function outdentListItem(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  // Must have a parent list item to outdent from
  if (!findParentListItem(listItem)) return false;

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

  // Compute how much the cursor shifts
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

// ---------------------------------------------------------------------------
// Move item up / down
// ---------------------------------------------------------------------------

/**
 * Move the current list item (and all its children) up, swapping it
 * with the previous sibling ListItem. The entire subtree moves as a unit.
 */
function moveListItemUp(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const prevItem = findPrevSibling(listItem);
  if (!prevItem) return false;

  const doc = view.state.doc;
  const cursorOffset = view.state.selection.main.head - listItem.from;

  // Extract text of both items (including trailing newline if present)
  const prevText = doc.sliceString(prevItem.from, prevItem.to);
  const currText = doc.sliceString(listItem.from, listItem.to);

  // Replace the range covering both items: [prevItem.from, listItem.to]
  // with currText first, then prevText
  const combinedFrom = prevItem.from;
  const combinedTo = listItem.to;
  const separator = doc.sliceString(prevItem.to, listItem.from);
  const newText = currText + separator + prevText;

  // After swap, the current item starts at prevItem.from
  const newCursorPos = prevItem.from + cursorOffset;

  view.dispatch({
    changes: { from: combinedFrom, to: combinedTo, insert: newText },
    selection: { anchor: newCursorPos },
  });

  return true;
}

/**
 * Move the current list item (and all its children) down, swapping it
 * with the next sibling ListItem. The entire subtree moves as a unit.
 */
function moveListItemDown(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const nextItem = findNextSibling(listItem);
  if (!nextItem) return false;

  const doc = view.state.doc;
  const cursorOffset = view.state.selection.main.head - listItem.from;

  // Extract text of both items
  const currText = doc.sliceString(listItem.from, listItem.to);
  const nextText = doc.sliceString(nextItem.from, nextItem.to);

  // Replace the range covering both items: [listItem.from, nextItem.to]
  // with nextText first, then currText
  const combinedFrom = listItem.from;
  const combinedTo = nextItem.to;
  const separator = doc.sliceString(listItem.to, nextItem.from);
  const newText = nextText + separator + currText;

  // After swap, the current item starts after the next item's text + separator
  const newCursorPos = listItem.from + nextText.length + separator.length + cursorOffset;

  view.dispatch({
    changes: { from: combinedFrom, to: combinedTo, insert: newText },
    selection: { anchor: newCursorPos },
  });

  return true;
}

// ---------------------------------------------------------------------------
// Enter: create new sibling / remove empty item
// ---------------------------------------------------------------------------

/**
 * When Enter is pressed inside a list item:
 * - If the item is empty (just the marker), remove it and exit the list
 * - Otherwise, split at cursor and create a new sibling item
 */
function enterInListItem(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const state = view.state;
  const doc = state.doc;
  const cursorPos = state.selection.main.head;
  const line = doc.lineAt(cursorPos);
  const lineText = line.text;

  const markerInfo = getListMarkerInfo(doc, listItem, line);
  if (!markerInfo) return false;

  // Check if the item content is empty (just the marker with no text after)
  const contentAfterMarker = lineText.slice(markerInfo.contentStart - line.from).trim();

  if (contentAfterMarker.length === 0) {
    // Empty item: remove the entire line (including the newline before it if possible)
    const removeFrom = line.number > 1 ? doc.line(line.number - 1).to : line.from;
    const removeTo = line.to;

    view.dispatch({
      changes: { from: removeFrom, to: removeTo },
      selection: { anchor: removeFrom },
    });
    return true;
  }

  // Split at cursor position: text before cursor stays, text after goes to new item
  const textAfterCursor = doc.sliceString(cursorPos, line.to);

  // Build the new line marker
  const newMarker = (
    markerInfo.orderedNumber !== undefined &&
    markerInfo.orderedDelimiter !== undefined
  )
    ? `${markerInfo.indent}${markerInfo.orderedNumber + 1}${markerInfo.orderedDelimiter} `
    : `${markerInfo.indent}${markerInfo.marker} `;

  const newLine = "\n" + newMarker + textAfterCursor;

  // Replace from cursor to end of line with just the newline + new item
  view.dispatch({
    changes: { from: cursorPos, to: line.to, insert: newLine },
    selection: { anchor: cursorPos + 1 + newMarker.length }, // after "\n" + marker
  });

  return true;
}

// ---------------------------------------------------------------------------
// Backspace: merge with previous item
// ---------------------------------------------------------------------------

/**
 * When Backspace is pressed at the very start of a list item's content
 * (right after the marker), merge the current item's content with the
 * previous item. Returns false for first items and non-list contexts.
 */
export function backspaceAtListItemStart(view: EditorView): boolean {
  const listItem = findListItemAtCursor(view);
  if (!listItem) return false;

  const state = view.state;
  const doc = state.doc;
  const cursorPos = state.selection.main.head;

  // Don't handle if there's a selection
  if (!state.selection.main.empty) return false;

  const line = doc.lineAt(cursorPos);
  const lineText = line.text;

  const markerInfo = getListMarkerInfo(doc, listItem, line);
  if (!markerInfo) return false;
  const contentStart = markerInfo.contentStart;

  // Only trigger if cursor is exactly at content start (right after marker)
  if (cursorPos !== contentStart) return false;

  // Find the previous ListItem sibling
  const prevItem = findPrevSibling(listItem);
  if (!prevItem) return false;

  // Get the last line of the previous item's own content (not children)
  // The previous item's first line is where we append
  const prevLine = doc.lineAt(prevItem.from);
  const prevLineEnd = prevLine.to;

  // Get the content of the current item (text after marker)
  const currentContent = lineText.slice(contentStart - line.from);

  // Remove only the current item's marker line, leaving both the
  // previous item's nested content and the current item's nested
  // children intact.
  const deleteFrom = line.from;
  const deleteTo = line.number < doc.lines ? doc.line(line.number + 1).from : line.to;

  view.dispatch({
    changes: [
      { from: prevLineEnd, insert: currentContent },
      { from: deleteFrom, to: deleteTo },
    ],
    selection: { anchor: prevLineEnd + currentContent.length },
  });

  return true;
}

// ---------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------

const listOutlinerKeymap = keymap.of([
  {
    key: "Tab",
    run: indentListItem,
  },
  {
    key: "Shift-Tab",
    run: outdentListItem,
  },
  {
    key: "Mod-Shift-ArrowUp",
    run: moveListItemUp,
  },
  {
    key: "Mod-Shift-ArrowDown",
    run: moveListItemDown,
  },
  {
    key: "Enter",
    run: enterInListItem,
  },
  {
    key: "Backspace",
    run: backspaceAtListItemStart,
  },
  ...foldKeymap,
]);

// ---------------------------------------------------------------------------
// Combined extension
// ---------------------------------------------------------------------------

/** CM6 extension for list outliner: fold/unfold, indent/outdent, move, Enter, Backspace. */
export const listOutlinerExtension: Extension = [
  listFoldService,
  codeFolding(),
  foldGutter(),
  listOutlinerKeymap,
];
