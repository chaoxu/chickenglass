import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

import { BLOCK_KEYBOARD_ACTIVATION_ATTRIBUTE } from "../block-keyboard-entry";
import { COFLAT_NESTED_EDIT_TAG } from "../update-tags";

type RawUpdatableNode = {
  getRaw?: () => string;
  setRaw?: (value: string) => unknown;
};

/** Prevent browser from placing a stray caret in non-editable KaTeX content. */
export function preventKatexMouseDown(event: MouseEvent) {
  event.preventDefault();
}

export function structureToggleProps(
  active: boolean,
  onActivate: () => void,
  options?: {
    keyboardActivation?: boolean;
    stopPropagation?: boolean;
    onBeforeActivate?: (element: HTMLElement, event: SyntheticEvent) => void;
  },
): Record<string, unknown> {
  if (!active) return {};

  const stop = options?.stopPropagation;
  const onBeforeActivate = options?.onBeforeActivate;
  return {
    onClick: (event: SyntheticEvent) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLElement) {
        onBeforeActivate?.(event.currentTarget, event);
      }
      if (stop) {
        event.stopPropagation();
      }
      onActivate();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) {
          onBeforeActivate?.(event.currentTarget, event);
        }
        if (stop) {
          event.stopPropagation();
        }
        onActivate();
      }
    },
    [BLOCK_KEYBOARD_ACTIVATION_ATTRIBUTE]: options?.keyboardActivation ? "true" : undefined,
    role: "button",
    tabIndex: 0,
  };
}

export function useRawBlockUpdater(nodeKey: NodeKey): (raw: string) => void {
  const [editor] = useLexicalComposerContext();

  return useCallback((nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey) as RawUpdatableNode | null;
      if (!node?.setRaw || node.getRaw?.() === nextRaw) {
        return;
      }
      node.setRaw(nextRaw);
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  }, [editor, nodeKey]);
}

const LAZY_VISIBILITY_ROOT_MARGIN = "1500px";

/**
 * Walk up the ancestor chain to find the nearest scroll container. The editor
 * scrolls inside `.cf-lexical-surface--scroll` (overflow: hidden) rather than
 * the document body — when an element lives inside that container but its
 * page-relative bounding box falls outside the viewport, IntersectionObserver
 * with `root: null` reports it as 0% visible because ancestor clipping wipes
 * out the visible area before the rootMargin can save it. Scoping the
 * observer to the scroll container fixes the off-screen math/citation
 * placeholders that otherwise stay "pending" forever.
 */
function findScrollRoot(el: Element): Element | null {
  let cursor: Element | null = el.parentElement;
  while (cursor) {
    const cs = getComputedStyle(cursor);
    if (cs.overflow !== "visible" || cs.overflowY !== "visible" || cs.overflowX !== "visible") {
      if (cursor !== document.scrollingElement && cursor !== document.documentElement) {
        return cursor;
      }
    }
    cursor = cursor.parentElement;
  }
  return null;
}

/**
 * Returns true once the element enters the viewport (with a generous margin
 * so scrolling rarely sees the placeholder). Stays true once flipped, so the
 * caller can render expensive content lazily without unmounting it again.
 *
 * In environments without IntersectionObserver (jsdom, SSR, very old
 * browsers) returns true immediately.
 */
export function useLazyVisibility(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const root = findScrollRoot(el);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { root, rootMargin: LAZY_VISIBILITY_ROOT_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, visible]);

  // Render eagerly when the user prints — printers expect the full document.
  useEffect(() => {
    if (visible) return;
    const handler = () => setVisible(true);
    window.addEventListener("beforeprint", handler);
    return () => window.removeEventListener("beforeprint", handler);
  }, [visible]);

  return visible;
}
