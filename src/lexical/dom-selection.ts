import type { MarkdownEditorSelection } from "./markdown-editor-types";

export function domTextOffsetWithin(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) {
    return null;
  }
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch (_error) {
    return null;
  }
  return range.toString().length;
}

export function readVisibleTextDomSelection(root: HTMLElement | null): MarkdownEditorSelection | null {
  if (!root) {
    return null;
  }
  const selection = root.ownerDocument.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
    return null;
  }
  const anchor = domTextOffsetWithin(root, anchorNode, selection.anchorOffset);
  const focus = domTextOffsetWithin(root, focusNode, selection.focusOffset);
  if (anchor === null || focus === null) {
    return null;
  }
  return {
    anchor,
    focus,
    from: Math.min(anchor, focus),
    to: Math.max(anchor, focus),
  };
}
