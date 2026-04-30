/**
 * CM6 list outliner extension.
 *
 * This module owns fold/keymap wiring. Editing behavior lives in
 * list-outliner-commands so command semantics stay testable without carrying
 * extension setup in the same file.
 */

import {
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  syntaxTree,
} from "@codemirror/language";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  backspaceAtListItemStart,
  enterInListItem,
  indentListItem,
  moveListItemDown,
  moveListItemUp,
  outdentListItem,
} from "./list-outliner-commands";

export {
  backspaceAtListItemStart,
  enterInListItem,
  outdentListItem,
} from "./list-outliner-commands";

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

const listFoldService = foldService.of((state, lineStart, _lineEnd) => {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(lineStart, 1);

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

  const itemLine = state.doc.lineAt(node.from);
  if (itemLine.from !== lineStart) return null;
  if (!hasNestedList(node)) return null;

  const foldFrom = itemLine.to;
  const foldTo = node.to;
  if (foldTo <= foldFrom) return null;

  return { from: foldFrom, to: foldTo };
});

const listOutlinerKeymap = Prec.high(keymap.of([
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
]));

const listOutlinerDomHandlers: Extension = EditorView.domEventHandlers({
  keydown(event, view) {
    let handled = false;
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handled = enterInListItem(view);
    } else if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handled = backspaceAtListItemStart(view);
    } else if (event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handled = outdentListItem(view);
    }

    if (!handled) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  },
});

export const listOutlinerExtension: Extension = [
  listFoldService,
  codeFolding(),
  foldGutter(),
  Prec.highest(listOutlinerDomHandlers),
  listOutlinerKeymap,
];
