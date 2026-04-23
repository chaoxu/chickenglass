import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface MarkdownImageContent {
  readonly alt: string;
  readonly src: string;
}

export function readMarkdownImageContent(
  state: EditorState,
  node: SyntaxNode,
): MarkdownImageContent | null {
  const urlNode = node.getChild("URL");
  if (!urlNode) return null;

  const src = state.sliceDoc(urlNode.from, urlNode.to);
  if (!src) return null;

  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2
    ? state.sliceDoc(marks[0].to, marks[1].from)
    : "";

  return { alt, src };
}
