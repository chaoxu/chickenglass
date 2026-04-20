import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  type LexicalNode,
  type NodeKey,
} from "lexical";

import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import { INLINE_TOKEN_KEY_ATTR } from "./inline-token-boundary";

function isInlineTokenBoundaryNode(
  node: LexicalNode | null | undefined,
): node is LexicalNode {
  return $isInlineMathNode(node)
    || $isReferenceNode(node)
    || $isInlineImageNode(node)
    || $isFootnoteReferenceNode(node);
}

function beforeInputText(event: InputEvent): string | null {
  if (event.inputType !== "insertText") {
    return null;
  }
  const text = event.data;
  return text && text !== "\n" ? text : null;
}

function inlineTokenKeyFromContainingNode(node: Node | null | undefined): NodeKey | null {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) {
    return null;
  }
  return element.closest(`[${INLINE_TOKEN_KEY_ATTR}]`)?.getAttribute(INLINE_TOKEN_KEY_ATTR)
    ?? null;
}

function inlineTokenKeyFromBoundaryNode(node: Node | null | undefined): NodeKey | null {
  const element = node instanceof Element ? node : node?.parentElement;
  return inlineTokenKeyFromContainingNode(node)
    ?? element?.querySelector(`[${INLINE_TOKEN_KEY_ATTR}]`)?.getAttribute(INLINE_TOKEN_KEY_ATTR)
    ?? null;
}

function readDomBoundaryToken(
  rootElement: HTMLElement,
): { readonly edge: "after" | "before"; readonly key: NodeKey } | null {
  const selection = rootElement.ownerDocument.getSelection();
  if (!selection?.isCollapsed) {
    return null;
  }

  const { anchorNode, anchorOffset } = selection;
  if (anchorNode instanceof Element) {
    const previous = anchorOffset > 0 ? anchorNode.childNodes.item(anchorOffset - 1) : null;
    const previousKey = inlineTokenKeyFromBoundaryNode(previous);
    if (previousKey) {
      return { edge: "after", key: previousKey };
    }

    const next = anchorNode.childNodes.item(anchorOffset);
    const nextKey = inlineTokenKeyFromBoundaryNode(next);
    if (nextKey) {
      return { edge: "before", key: nextKey };
    }
  }

  const containingKey = inlineTokenKeyFromContainingNode(anchorNode);
  return containingKey ? { edge: "after", key: containingKey } : null;
}

function $insertTextAtInlineTokenBoundary(
  boundary: { readonly edge: "after" | "before"; readonly key: NodeKey },
  text: string,
): boolean {
  const node = $getNodeByKey(boundary.key);
  if (!isInlineTokenBoundaryNode(node)) {
    return false;
  }

  const textNode = $createTextNode(text);
  if (boundary.edge === "after") {
    node.insertAfter(textNode);
  } else {
    node.insertBefore(textNode);
  }
  textNode.selectEnd();
  return true;
}

export function InlineTokenBoundaryPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleBeforeInput = (rootElement: HTMLElement) => (event: InputEvent) => {
      const text = beforeInputText(event);
      if (!text) {
        return;
      }

      const boundary = readDomBoundaryToken(rootElement);
      if (!boundary) {
        return;
      }

      const ownsBoundary = editor.getEditorState().read(() =>
        isInlineTokenBoundaryNode($getNodeByKey(boundary.key))
      );
      if (!ownsBoundary) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      editor.update(() => {
        $insertTextAtInlineTokenBoundary(boundary, text);
      }, {
        discrete: true,
        tag: COFLAT_NESTED_EDIT_TAG,
      });
    };
    const handlers = new WeakMap<HTMLElement, (event: InputEvent) => void>();

    return editor.registerRootListener((rootElement, previousRootElement) => {
      if (previousRootElement) {
        const previousHandler = handlers.get(previousRootElement);
        if (previousHandler) {
          previousRootElement.removeEventListener(
            "beforeinput",
            previousHandler,
            { capture: true },
          );
          handlers.delete(previousRootElement);
        }
      }
      if (!rootElement) {
        return;
      }
      const handler = handleBeforeInput(rootElement);
      handlers.set(rootElement, handler);
      rootElement.addEventListener("beforeinput", handler, { capture: true });
      return () => {
        rootElement.removeEventListener("beforeinput", handler, { capture: true });
        handlers.delete(rootElement);
      };
    });
  }, [editor]);

  return null;
}
