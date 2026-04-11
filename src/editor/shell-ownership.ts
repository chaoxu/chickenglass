import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { FencedDivInfo } from "../fenced-block/model";
import { collectFencedDivs } from "../fenced-block/model";
import { findAncestor, isFencedCode } from "../lib/syntax-tree-helpers";
import { containsRange } from "../lib/range-helpers";
import { editorFocusField } from "../state/editor-focus";
import { frontmatterField } from "./frontmatter-state";

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

interface ActiveFencedCache {
  readonly path: FencedDivInfo[];
  readonly openFenceStarts: ReadonlySet<number>;
}

const activeFencedCache = new WeakMap<EditorState, ActiveFencedCache>();

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
    const node: SyntaxNode | null = tree.resolveInner(clampedPos, side);
    const codeBlock = findAncestor(node, isFencedCode);
    if (codeBlock) {
      return codeShellInfoFromNode(state, codeBlock);
    }
  }
  return null;
}

export function activeFencedPath(state: EditorState): FencedDivInfo[] {
  const cached = activeFencedCache.get(state);
  if (cached) {
    return cached.path;
  }
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) {
    activeFencedCache.set(state, {
      path: [],
      openFenceStarts: new Set(),
    });
    return [];
  }
  const selection = currentSelectionRange(state);
  const path = collectFencedDivs(state)
    .filter((div) => containsRange(div, selection))
    .sort((a, b) => (a.from - b.from) || (a.to - b.to));
  activeFencedCache.set(state, {
    path,
    openFenceStarts: new Set(path.map((div) => div.openFenceFrom)),
  });
  return path;
}

export function activeFencedOpenFenceStarts(state: EditorState): ReadonlySet<number> {
  const cached = activeFencedCache.get(state);
  if (cached) {
    return cached.openFenceStarts;
  }
  activeFencedPath(state);
  return activeFencedCache.get(state)?.openFenceStarts ?? new Set();
}

export function activeFencedDepthAtRange(
  state: EditorState,
  from: number,
  to: number,
): number {
  if (from < 0 || to < from) return 0;
  let depth = 0;
  for (const div of activeFencedPath(state)) {
    if (containsRange(div, { from, to })) {
      depth += 1;
    }
  }
  return depth;
}

export function activeCodeBlock(state: EditorState): CodeShellInfo | null {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return null;
  const selection = currentSelectionRange(state);
  const block = findCodeShellAt(state, selection.from) ?? findCodeShellAt(state, selection.to);
  if (!block) return null;
  return containsRange(block, selection) ? block : null;
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
  return end > 0 && containsRange({ from: 0, to: end }, selection);
}
