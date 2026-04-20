import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $addUpdateTag,
  $getNodeByKey,
  type LexicalNode,
  type NodeKey,
} from "lexical";

import { useDocumentChangeBridge } from "../document-change-bridge";
import {
  COFLAT_INCREMENTAL_DOC_CHANGE_TAG,
  COFLAT_NESTED_EDIT_TAG,
} from "../update-tags";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";
import {
  surfaceActivationProps,
  type SurfaceActivationPropsOptions,
} from "../surface-activation";
import {
  getPendingEmbeddedSurfaceFocusId,
  type PendingEmbeddedSurfaceFocusTarget,
} from "../pending-surface-focus";
import {
  applyRawBlockSourceRangeChange,
  findRawBlockSourceRangeElement,
  readRawBlockSourceRangeFromElement,
  useRawBlockSourceRange,
  writeRawBlockSourceRangeToElement,
} from "./raw-block-source-range";

type RawUpdatableNode = {
  getRaw?: () => string;
  setRaw?: (value: string) => unknown;
};

type RawUpdate = string | ((currentRaw: string) => string);

/** Prevent browser from placing a stray caret in non-editable KaTeX content. */
export function preventKatexMouseDown(event: MouseEvent) {
  event.preventDefault();
}

export function structureToggleProps(
  active: boolean,
  onActivate: () => void,
  options?: SurfaceActivationPropsOptions,
): Record<string, unknown> {
  return surfaceActivationProps(active, onActivate, options);
}

export function useRawBlockUpdater(nodeKey: NodeKey): (raw: RawUpdate) => void {
  const [editor] = useLexicalComposerContext();
  const documentChangeBridge = useDocumentChangeBridge();
  const sourceRange = useRawBlockSourceRange();

  return useCallback((next: RawUpdate) => {
    const pendingIncremental: {
      change: EditorDocumentChange | null;
      rangeElement: HTMLElement | null;
      nextRawLength: number | null;
    } = {
      change: null,
      rangeElement: null,
      nextRawLength: null,
    };
    editor.update(() => {
      const node = $getNodeByKey(nodeKey) as (RawUpdatableNode & LexicalNode) | null;
      if (!node?.setRaw) {
        return;
      }
      const currentRaw = node.getRaw?.() ?? "";
      const nextRaw = typeof next === "function" ? next(currentRaw) : next;
      if (currentRaw === nextRaw) {
        return;
      }
      const rangeElement = findRawBlockSourceRangeElement(editor.getRootElement(), nodeKey);
      const range = sourceRange?.readRange()
        ?? (rangeElement ? readRawBlockSourceRangeFromElement(rangeElement) : null);
      const rangeChange = range
        ? documentChangeBridge?.createSourceReplacement(range, currentRaw, nextRaw) ?? null
        : null;
      pendingIncremental.change = rangeChange ?? documentChangeBridge?.createNodeSourceReplacement(
          node,
          currentRaw,
          nextRaw,
        ) ?? null;
      pendingIncremental.rangeElement = rangeElement;
      pendingIncremental.nextRawLength = nextRaw.length;
      if (pendingIncremental.change) {
        $addUpdateTag(COFLAT_INCREMENTAL_DOC_CHANGE_TAG);
      }
      node.setRaw(nextRaw);
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
    if (pendingIncremental.change) {
      if (pendingIncremental.nextRawLength !== null) {
        if (sourceRange) {
          sourceRange.writeRange(
            pendingIncremental.change.from,
            pendingIncremental.change.from + pendingIncremental.nextRawLength,
          );
        } else if (pendingIncremental.rangeElement) {
          writeRawBlockSourceRangeToElement(
            pendingIncremental.rangeElement,
            pendingIncremental.change.from,
            pendingIncremental.change.from + pendingIncremental.nextRawLength,
          );
        }
        applyRawBlockSourceRangeChange(
          editor.getRootElement(),
          pendingIncremental.change.from,
          pendingIncremental.change.to,
          pendingIncremental.change.from + pendingIncremental.nextRawLength,
        );
      }
      documentChangeBridge?.publishChanges([pendingIncremental.change]);
    }
  }, [documentChangeBridge, editor, nodeKey, sourceRange]);
}

export function usePendingEmbeddedSurfaceFocusId(
  nodeKey: NodeKey,
  target: PendingEmbeddedSurfaceFocusTarget,
): string {
  const [editor] = useLexicalComposerContext();
  return useMemo(
    () => getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, target),
    [editor, nodeKey, target],
  );
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
