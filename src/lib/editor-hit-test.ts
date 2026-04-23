import type { EditorView } from "@codemirror/view";

export interface EditorHitPoint {
  readonly x: number;
  readonly y: number;
}

export interface EditorLineBounds {
  readonly from: number;
  readonly to: number;
  readonly fromLine: number;
  readonly toLine: number;
}

export type EditorHitTestStrategy = "precise" | "coarse" | "dom-caret";

export interface EditorHitPosition {
  readonly pos: number;
  readonly line: number;
  readonly strategy: EditorHitTestStrategy;
}

export interface EditorHitPositionAndSide extends EditorHitPosition {
  readonly assoc: number;
}

export interface EditorHitTestSnapshot {
  readonly precise: EditorHitPosition | null;
  readonly coarse: EditorHitPosition | null;
  readonly domCaret: EditorHitPosition | null;
  readonly lineBounds: EditorLineBounds | null;
}

interface LegacyCaretRangeDocument {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

interface DomCaretOptions {
  readonly within?: Node;
  readonly bounds?: EditorLineBounds;
}

export function safePosAtDOM(
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

export function editorElementFromPoint(
  view: EditorView,
  point: EditorHitPoint,
): Element | null {
  return view.dom.ownerDocument.elementFromPoint(point.x, point.y);
}

export function editorElementsFromPoint(
  view: EditorView,
  point: EditorHitPoint,
): Element[] {
  return view.dom.ownerDocument.elementsFromPoint(point.x, point.y);
}

export function closestLineElement(target: EventTarget | Node | null): HTMLElement | null {
  return target instanceof HTMLElement
    ? target.closest<HTMLElement>(".cm-line")
    : null;
}

export function lineElementAtPoint(
  view: EditorView,
  point: EditorHitPoint,
  target?: EventTarget | Node | null,
): HTMLElement | null {
  const fromTarget = closestLineElement(target ?? null);
  if (fromTarget) return fromTarget;
  return closestLineElement(editorElementFromPoint(view, point));
}

export function lineBoundsForElement(
  view: EditorView,
  line: HTMLElement,
): EditorLineBounds | null {
  const from = safePosAtDOM(view, line, 0);
  if (from === null) return null;

  const to = safePosAtDOM(view, line, line.childNodes.length) ?? from;
  return {
    from,
    to,
    fromLine: view.state.doc.lineAt(from).number,
    toLine: view.state.doc.lineAt(to).number,
  };
}

export function lineBoundsAtPoint(
  view: EditorView,
  point: EditorHitPoint,
  target?: EventTarget | Node | null,
): EditorLineBounds | null {
  const line = lineElementAtPoint(view, point, target);
  return line ? lineBoundsForElement(view, line) : null;
}

export function clampToLineBounds(bounds: EditorLineBounds, pos: number): number {
  return Math.max(bounds.from, Math.min(bounds.to, pos));
}

function positionWithLine(
  view: EditorView,
  pos: number | null,
  strategy: EditorHitTestStrategy,
): EditorHitPosition | null {
  return pos === null
    ? null
    : {
      pos,
      line: view.state.doc.lineAt(pos).number,
      strategy,
    };
}

export function preciseHitTestPosition(
  view: EditorView,
  point: EditorHitPoint,
): EditorHitPosition | null {
  return positionWithLine(view, view.posAtCoords(point), "precise");
}

export function coarseHitTestPosition(
  view: EditorView,
  point: EditorHitPoint,
): EditorHitPosition | null {
  return positionWithLine(view, view.posAtCoords(point, false), "coarse");
}

export function coarseHitTestPositionAndSide(
  view: EditorView,
  point: EditorHitPoint,
  bounds?: EditorLineBounds,
): EditorHitPositionAndSide | null {
  const resolved = view.posAndSideAtCoords(point, false);
  if (!resolved) return null;
  if (bounds && (resolved.pos < bounds.from || resolved.pos > bounds.to)) {
    return null;
  }
  const pos = bounds ? clampToLineBounds(bounds, resolved.pos) : resolved.pos;
  return {
    pos,
    assoc: resolved.assoc,
    line: view.state.doc.lineAt(pos).number,
    strategy: "coarse",
  };
}

function posFromDomCaretNode(
  view: EditorView,
  node: Node,
  offset: number,
  options: DomCaretOptions,
): EditorHitPosition | null {
  if (options.within && !options.within.contains(node)) return null;
  const rawPos = safePosAtDOM(view, node, offset);
  if (rawPos === null) return null;
  const pos = options.bounds ? clampToLineBounds(options.bounds, rawPos) : rawPos;
  return {
    pos,
    line: view.state.doc.lineAt(pos).number,
    strategy: "dom-caret",
  };
}

export function domCaretHitTestPosition(
  view: EditorView,
  point: EditorHitPoint,
  options: DomCaretOptions = {},
): EditorHitPosition | null {
  const doc = view.dom.ownerDocument as Document & LegacyCaretRangeDocument;

  const caretPosition = doc.caretPositionFromPoint?.(point.x, point.y);
  if (caretPosition) {
    const hit = posFromDomCaretNode(
      view,
      caretPosition.offsetNode,
      caretPosition.offset,
      options,
    );
    if (hit) return hit;
  }

  const caretRange = doc.caretRangeFromPoint?.(point.x, point.y);
  if (caretRange) {
    const hit = posFromDomCaretNode(
      view,
      caretRange.startContainer,
      caretRange.startOffset,
      options,
    );
    if (hit) return hit;
  }

  return null;
}

export function editorHitTestSnapshot(
  view: EditorView,
  point: EditorHitPoint,
  target?: EventTarget | Node | null,
): EditorHitTestSnapshot {
  return {
    precise: preciseHitTestPosition(view, point),
    coarse: coarseHitTestPosition(view, point),
    domCaret: domCaretHitTestPosition(view, point, { within: view.contentDOM }),
    lineBounds: lineBoundsAtPoint(view, point, target),
  };
}
