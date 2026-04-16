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
    stopPropagation?: boolean;
    onBeforeActivate?: (element: HTMLElement) => void;
  },
): Record<string, unknown> {
  if (!active) return {};

  const stop = options?.stopPropagation;
  const onBeforeActivate = options?.onBeforeActivate;
  return {
    onClick: (event: SyntheticEvent) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLElement) {
        onBeforeActivate?.(event.currentTarget);
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
          onBeforeActivate?.(event.currentTarget);
        }
        if (stop) {
          event.stopPropagation();
        }
        onActivate();
      }
    },
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
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: LAZY_VISIBILITY_ROOT_MARGIN });
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
