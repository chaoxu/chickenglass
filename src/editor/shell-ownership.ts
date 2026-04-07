import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { FencedDivInfo } from "../fenced-block/model";
import { collectFencedDivs } from "../fenced-block/model";
import { frontmatterField } from "./frontmatter-state";
import { editorFocusField } from "../render/focus-state";

export interface CodeShellInfo {
  readonly from: number;
  readonly to: number;
  readonly openFenceFrom: number;
  readonly openFenceTo: number;
  readonly closeFenceFrom: number;
  readonly closeFenceTo: number;
  readonly marker: string;
  readonly language: string;
}

export type ActiveShellPathEntry =
  | { readonly kind: "fenced"; readonly depth: number; readonly block: FencedDivInfo }
  | { readonly kind: "code"; readonly depth: number; readonly block: CodeShellInfo };

function currentSelectionRange(state: EditorState): {
  readonly from: number;
  readonly to: number;
} {
  const main = state.selection.main;
  return {
    from: main.from,
    to: main.to,
  };
}

function codeShellInfoFromNode(
  state: EditorState,
  node: SyntaxNode,
): CodeShellInfo | null {
  const openLine = state.doc.lineAt(node.from);
  const closeLine = state.doc.lineAt(node.to);
  const markerMatch = /^\s*([`~]{3,})/.exec(openLine.text);
  if (!markerMatch) return null;
  const codeInfoNode = node.getChild("CodeInfo");
  return {
    from: node.from,
    to: node.to,
    openFenceFrom: openLine.from,
    openFenceTo: openLine.to,
    closeFenceFrom: closeLine.from,
    closeFenceTo: closeLine.to,
    marker: markerMatch[1],
    language: codeInfoNode
      ? state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).trim()
      : "",
  };
}

export function findCodeShellAt(
  state: EditorState,
  pos: number,
): CodeShellInfo | null {
  const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(clampedPos, side);
    while (node) {
      if (node.name === "FencedCode") {
        return codeShellInfoFromNode(state, node);
      }
      node = node.parent;
    }
  }
  return null;
}

export function activeFencedPath(state: EditorState): FencedDivInfo[] {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return [];
  const selection = currentSelectionRange(state);
  return collectFencedDivs(state)
    .filter((div) => selection.from >= div.from && selection.to <= div.to)
    .sort((a, b) => (a.from - b.from) || (a.to - b.to));
}

export function activeFencedOpenFenceStarts(state: EditorState): ReadonlySet<number> {
  return new Set(activeFencedPath(state).map((div) => div.openFenceFrom));
}

export function activeCodeBlock(state: EditorState): CodeShellInfo | null {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return null;
  const selection = currentSelectionRange(state);
  const block = findCodeShellAt(state, selection.from) ?? findCodeShellAt(state, selection.to);
  if (!block) return null;
  return selection.from >= block.from && selection.to <= block.to ? block : null;
}

export function activeCodeBlockOpenFenceStarts(state: EditorState): ReadonlySet<number> {
  const block = activeCodeBlock(state);
  return block ? new Set([block.openFenceFrom]) : new Set();
}

export function activeShellPath(state: EditorState): ActiveShellPathEntry[] {
  const fencedPath = activeFencedPath(state).map((block, depth) => ({
    kind: "fenced" as const,
    depth,
    block,
  }));
  const codeBlock = activeCodeBlock(state);
  if (!codeBlock) return fencedPath;
  return [
    ...fencedPath,
    {
      kind: "code" as const,
      depth: fencedPath.length,
      block: codeBlock,
    },
  ];
}

export function isFrontmatterActive(state: EditorState): boolean {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return false;
  const { end } = state.field(frontmatterField);
  const selection = currentSelectionRange(state);
  return end > 0 && selection.from >= 0 && selection.to <= end;
}
