import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { TextNode } from "lexical";

/**
 * Lexical's MarkdownShortcutPlugin only runs element transformers at the
 * document root, so typing `- `, `* `, `+ `, or `N. ` inside a list item
 * (e.g. after pressing Enter to continue a list) leaves the literal marker
 * in the text, producing `- one\n- - two` on round-trip.
 *
 * This transform strips a redundant bullet/number marker from the first
 * text node of a list item when it matches the parent list's type. The
 * visual marker is supplied by the list node itself, so the typed marker
 * is always redundant — this keeps the serialized markdown clean without
 * adding any keyboard state tracking.
 */
const BULLET_MARKER_RE = /^[-*+]\s/;
const NUMBER_MARKER_RE = /^\d+\.\s/;

export function ListMarkerStripPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        const listItem = node.getParent();
        if (!$isListItemNode(listItem)) return;
        if (listItem.getFirstChild() !== node) return;

        const list = listItem.getParent();
        if (!$isListNode(list)) return;

        const listType = list.getListType();
        const re =
          listType === "bullet"
            ? BULLET_MARKER_RE
            : listType === "number"
              ? NUMBER_MARKER_RE
              : null;
        if (!re) return;

        const match = re.exec(node.getTextContent());
        if (!match) return;

        node.spliceText(0, match[0].length, "", true);
      }),
    [editor],
  );

  return null;
}
