/**
 * List outliner: fold/unfold and indent/outdent for list items.
 *
 * - Fold: uses CM6 foldService so that ListItems with children
 *   (nested BulletList or OrderedList) can be collapsed.
 * - Indent (Tab): adds 2 spaces to the current list item and all
 *   its children, respecting maximum nesting constraints.
 * - Outdent (Shift-Tab): removes 2 spaces from the current list
 *   item and all its children.
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
  ...foldKeymap,
]);

// ---------------------------------------------------------------------------
// Combined extension
// ---------------------------------------------------------------------------

/** CM6 extension for list outliner: fold/unfold + indent/outdent. */
export const listOutlinerExtension: Extension = [
  listFoldService,
  codeFolding(),
  foldGutter(),
  listOutlinerKeymap,
];
