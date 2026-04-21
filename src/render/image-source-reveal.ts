import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSet,
  type EditorState,
  type Range,
} from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { editorFocusField } from "./focus-state";
import { addInlineRevealSourceMetricsInSubtree } from "./markdown-inline-source";

export interface ActiveImageSourceTarget {
  readonly from: number;
  readonly to: number;
}

export function isStandaloneImageLine(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const line = state.doc.lineAt(from);
  const imageText = state.sliceDoc(from, to);
  return line.text.trim() === imageText;
}

export function activeSourceTargetsEqual(
  a: ActiveImageSourceTarget | null,
  b: ActiveImageSourceTarget | null,
): boolean {
  return a?.from === b?.from && a?.to === b?.to;
}

export function mapActiveSourceTargetThroughChanges(
  target: ActiveImageSourceTarget | null,
  state: EditorState,
  changes: ChangeSet,
): ActiveImageSourceTarget | null {
  if (!target) return null;
  const from = Math.max(
    0,
    Math.min(changes.mapPos(target.from, 1), state.doc.length),
  );
  const to = Math.max(
    from,
    Math.min(changes.mapPos(target.to, -1), state.doc.length),
  );
  return { from, to };
}

function findSelectionImageNode(state: EditorState): SyntaxNode | null {
  const selection = state.selection.main;
  const tree = syntaxTree(state);
  const positions = selection.from === selection.to
    ? [selection.from]
    : [selection.from, selection.to];

  for (const pos of positions) {
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(pos, side);
      while (node.parent) {
        if (
          node.name === "Image" &&
          selection.from >= node.from &&
          selection.to <= node.to
        ) {
          return node;
        }
        node = node.parent;
      }
    }
  }

  return null;
}

export function getActiveImageSourceTarget(
  state: EditorState,
): ActiveImageSourceTarget | null {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return null;

  const node = findSelectionImageNode(state);
  if (!node || !isStandaloneImageLine(state, node.from, node.to)) return null;
  return { from: node.from, to: node.to };
}

export function addActiveImageSourceDecorations(
  state: EditorState,
  target: ActiveImageSourceTarget,
  items: Range<Decoration>[],
): void {
  syntaxTree(state).iterate({
    from: target.from,
    to: target.to,
    enter(node) {
      if (node.name !== "Image" || node.from !== target.from || node.to !== target.to) {
        return;
      }
      addInlineRevealSourceMetricsInSubtree(node.node, items);
      return false;
    },
  });
}
