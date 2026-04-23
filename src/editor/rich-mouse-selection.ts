import type { EditorSelection } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  buildPointerSelection,
  isPlainPrimaryMouseEvent,
  type PointerSelectionTarget,
} from "../state/mouse-selection";

function isRichLikeMode(view: EditorView): boolean {
  return !view.dom.classList.contains(CSS.sourceMode);
}

function safePosAtDOM(
  view: EditorView,
  node: Node,
  offset: number,
): number | null {
  try {
    return view.posAtDOM(node, offset);
  } catch (_error) {
    return null;
  }
}

function elementFromPoint(
  root: Document,
  x: number,
  y: number,
): Element | null {
  const hit = root.elementFromPoint(x, y);
  return hit;
}

function lineElementFromTarget(
  target: EventTarget | null,
): HTMLElement | null {
  return target instanceof HTMLElement
    ? target.closest<HTMLElement>(".cm-line")
    : null;
}

function lineElementAtPoint(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): HTMLElement | null {
  const fromTarget = lineElementFromTarget(target);
  if (fromTarget) return fromTarget;
  const fromPoint = elementFromPoint(view.dom.ownerDocument, x, y);
  return lineElementFromTarget(fromPoint);
}

function lineBounds(
  view: EditorView,
  line: HTMLElement,
): { from: number; to: number } | null {
  const from = safePosAtDOM(view, line, 0);
  if (from === null) return null;
  const to = safePosAtDOM(view, line, line.childNodes.length) ?? from;
  return { from, to };
}

function clampToLine(bounds: { from: number; to: number }, pos: number): number {
  return Math.max(bounds.from, Math.min(bounds.to, pos));
}

function domCaretTargetAtPoint(
  view: EditorView,
  x: number,
  y: number,
  line: HTMLElement,
  bounds: { from: number; to: number },
): PointerSelectionTarget | null {
  const doc = view.dom.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { readonly offsetNode: Node; readonly offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const caretPosition = doc.caretPositionFromPoint?.(x, y);
  if (caretPosition && line.contains(caretPosition.offsetNode)) {
    const pos = safePosAtDOM(view, caretPosition.offsetNode, caretPosition.offset);
    if (pos !== null) {
      return {
        pos: clampToLine(bounds, pos),
        assoc: pos <= bounds.from ? 1 : pos >= bounds.to ? -1 : 1,
      };
    }
  }

  const caretRange = doc.caretRangeFromPoint?.(x, y);
  if (caretRange && line.contains(caretRange.startContainer)) {
    const pos = safePosAtDOM(view, caretRange.startContainer, caretRange.startOffset);
    if (pos !== null) {
      return {
        pos: clampToLine(bounds, pos),
        assoc: pos <= bounds.from ? 1 : pos >= bounds.to ? -1 : 1,
      };
    }
  }

  return null;
}

function coordTargetAtPoint(
  view: EditorView,
  x: number,
  y: number,
  bounds: { from: number; to: number },
): PointerSelectionTarget | null {
  const resolved = view.posAndSideAtCoords({ x, y }, false);
  if (!resolved) return null;
  if (resolved.pos < bounds.from || resolved.pos > bounds.to) return null;
  return {
    pos: clampToLine(bounds, resolved.pos),
    assoc: resolved.assoc,
  };
}

function fallbackTargetForLine(
  line: HTMLElement,
  bounds: { from: number; to: number },
  x: number,
): PointerSelectionTarget {
  const text = (line.textContent ?? "").trim();
  if (text.length === 0) {
    return { pos: bounds.from, assoc: 1 };
  }

  const rect = line.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;
  return x >= midpoint
    ? { pos: bounds.to, assoc: -1 }
    : { pos: bounds.from, assoc: 1 };
}

function resolveVisibleLineTarget(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): PointerSelectionTarget | null {
  const line = lineElementAtPoint(view, x, y, target);
  if (!line) return null;
  const bounds = lineBounds(view, line);
  if (!bounds) return null;
  return (
    coordTargetAtPoint(view, x, y, bounds)
    ?? 
    domCaretTargetAtPoint(view, x, y, line, bounds)
    ?? fallbackTargetForLine(line, bounds, x)
  );
}

function isContentSurfaceTarget(
  view: EditorView,
  target: EventTarget | null,
): boolean {
  return target instanceof HTMLElement
    && (
      target === view.contentDOM ||
      target.classList.contains("cm-content") ||
      view.contentDOM.contains(target)
    );
}

function hasVisibleLineUnderPoint(
  view: EditorView,
  x: number,
  y: number,
): boolean {
  return view.dom.ownerDocument.elementsFromPoint(x, y)
    .some((element) => element instanceof HTMLElement && view.contentDOM.contains(element) && element.classList.contains("cm-line"));
}

function startsOnRenderedMath(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  const direct = target instanceof HTMLElement
    ? target.closest<HTMLElement>(`.${CSS.mathInline}`)
    : null;
  if (direct) return true;
  const fromPoint = elementFromPoint(view.dom.ownerDocument, x, y);
  return fromPoint instanceof HTMLElement
    ? Boolean(fromPoint.closest(`.${CSS.mathInline}`))
    : false;
}

function startsOnWidgetOwnedSurface(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  const direct = target instanceof HTMLElement
    ? target.closest<HTMLElement>("[data-source-from]")
    : null;
  if (direct && !direct.classList.contains("cm-line")) return true;
  const fromPoint = elementFromPoint(view.dom.ownerDocument, x, y);
  return fromPoint instanceof HTMLElement
    ? Boolean(fromPoint.closest("[data-source-from]:not(.cm-line)"))
    : false;
}

function mapTarget(
  target: PointerSelectionTarget,
  update: ViewUpdate,
): PointerSelectionTarget {
  return {
    pos: update.changes.mapPos(target.pos, target.assoc),
    assoc: target.assoc,
  };
}

function createStickySelectionStyle(
  selection: EditorSelection,
) {
  return {
    get() {
      return selection;
    },
    update() {
      return false;
    },
  };
}

function createRichMouseSelectionStyle(
  view: EditorView,
  start: PointerSelectionTarget,
) {
  let startTarget = start;
  let lastResolvedTarget = start;

  return {
    get(currentEvent: MouseEvent) {
      const resolved = resolveVisibleLineTarget(
        view,
        currentEvent.clientX,
        currentEvent.clientY,
        currentEvent.target,
      ) ?? lastResolvedTarget;
      lastResolvedTarget = resolved;
      return buildPointerSelection(startTarget, resolved);
    },

    update(update: ViewUpdate) {
      if (!update.docChanged) return false;
      startTarget = mapTarget(startTarget, update);
      lastResolvedTarget = mapTarget(lastResolvedTarget, update);
      return false;
    },
  };
}

export const richMouseSelectionStyle = EditorView.mouseSelectionStyle.of((view, event) => {
  if (!isRichLikeMode(view)) return null;
  if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return null;
  if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return null;
  if (startsOnWidgetOwnedSurface(view, event.clientX, event.clientY, event.target)) return null;

  const start = resolveVisibleLineTarget(
    view,
    event.clientX,
    event.clientY,
    event.target,
  );
  if (start) {
    return createRichMouseSelectionStyle(view, start);
  }

  if (
    isContentSurfaceTarget(view, event.target) &&
    !hasVisibleLineUnderPoint(view, event.clientX, event.clientY)
  ) {
    return createStickySelectionStyle(view.state.selection);
  }

  return null;
});
