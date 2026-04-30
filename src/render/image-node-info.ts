import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  isStandaloneImageLine,
  readMarkdownImageContent,
} from "../state/markdown-image";
import {
  type MediaPreviewResult,
  resolveLocalMediaPreviewFromState,
} from "./media-preview";
import {
  rangeIntersectsDirtyRanges,
  type DirtyRange,
} from "./incremental-dirty-ranges";

export interface ImageNodeInfo {
  readonly from: number;
  readonly to: number;
  readonly alt: string;
  readonly src: string;
  readonly isBlock: boolean;
  readonly preview: MediaPreviewResult | null;
}

export function refreshImageNodeInfoPreview(
  state: EditorState,
  info: ImageNodeInfo,
): ImageNodeInfo {
  return {
    ...info,
    preview: resolveLocalMediaPreviewFromState(state, info.src),
  };
}

export function buildImageNodeInfo(
  state: EditorState,
  node: SyntaxNode,
): ImageNodeInfo | null {
  const parsed = readMarkdownImageContent(state, node);
  if (!parsed) return null;

  return {
    from: node.from,
    to: node.to,
    alt: parsed.alt,
    src: parsed.src,
    isBlock: isStandaloneImageLine(state, node.from, node.to),
    preview: resolveLocalMediaPreviewFromState(state, parsed.src),
  };
}

export function collectImageNodeInfosInRanges(
  state: EditorState,
  dirtyRanges: readonly DirtyRange[],
): ImageNodeInfo[] {
  if (dirtyRanges.length === 0) return [];
  const infos: ImageNodeInfo[] = [];
  const seen = new Set<string>();

  for (const range of dirtyRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== "Image") return;
        if (!rangeIntersectsDirtyRanges(node.from, node.to, [range])) return;
        const key = `${node.from}:${node.to}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const info = buildImageNodeInfo(state, node.node);
        if (info) infos.push(info);
        return false;
      },
    });
  }

  return infos;
}

export function collectAllImageNodeInfos(state: EditorState): ImageNodeInfo[] {
  return collectImageNodeInfosInRanges(state, [{ from: 0, to: state.doc.length }]);
}
