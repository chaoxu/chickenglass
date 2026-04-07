import { type EditorView } from "@codemirror/view";
import { getLineElement } from "../render/render-core";

const FALLBACK_LINE_HEIGHT_PX = 24;
const REVERSE_SCROLL_THRESHOLD_PX = 120;
const pendingReverseScrollGuardIds = new WeakMap<EditorView, number>();
let nextReverseScrollGuardId = 0;

interface VerticalMotionSnapshot {
  readonly head: number;
  readonly line: number;
  readonly scrollTop: number;
}

function snapshotVerticalMotion(view: EditorView): VerticalMotionSnapshot {
  const head = view.state.selection.main.head;
  return {
    head,
    line: view.state.doc.lineAt(head).number,
    scrollTop: view.scrollDOM.scrollTop,
  };
}

function readLineHeight(
  view: EditorView,
  lineNumber: number,
): number {
  const lineEl = getLineElement(view, view.state.doc.line(lineNumber).from);
  if (!lineEl) return FALLBACK_LINE_HEIGHT_PX;

  const height = Number.parseFloat(window.getComputedStyle(lineEl).height);
  return Number.isFinite(height) && height > 0 ? height : FALLBACK_LINE_HEIGHT_PX;
}

export function sumTraversedLineHeights(
  fromLine: number,
  toLine: number,
  getLineHeight: (lineNumber: number) => number,
): number {
  if (fromLine === toLine) return 0;

  let total = 0;
  if (toLine < fromLine) {
    for (let line = toLine; line < fromLine; line += 1) {
      total += getLineHeight(line);
    }
    return total;
  }

  for (let line = fromLine; line < toLine; line += 1) {
    total += getLineHeight(line);
  }
  return total;
}

export function correctedReverseVerticalScrollTop(
  before: VerticalMotionSnapshot,
  after: VerticalMotionSnapshot,
  traversedHeight: number,
): number | null {
  const lineDelta = after.line - before.line;
  const headDelta = after.head - before.head;
  const scrollDelta = after.scrollTop - before.scrollTop;
  const movedUp = lineDelta < 0 || headDelta < 0;
  const movedDown = lineDelta > 0 || headDelta > 0;

  if (movedUp && scrollDelta >= REVERSE_SCROLL_THRESHOLD_PX) {
    return Math.max(0, before.scrollTop - traversedHeight);
  }
  if (movedDown && scrollDelta <= -REVERSE_SCROLL_THRESHOLD_PX) {
    return before.scrollTop + traversedHeight;
  }
  return null;
}

/**
 * Preserve expected viewport motion during rich-mode ArrowUp/ArrowDown.
 *
 * CM6's native `scrollIntoView` can jump the viewport in the opposite
 * direction when vertical movement crosses rendered display/math or collapsed
 * structural lines. We let CM6 compute the new selection, then clamp only the
 * pathological reverse-scroll case based on the traversed rendered line
 * heights. This keeps ordinary vertical motion intact while fixing #963.
 */
export function moveVerticallyWithReverseScrollGuard(
  view: EditorView,
  forward: boolean,
): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;

  const nextRange = view.moveVertically(range, forward);
  if (nextRange.anchor === range.anchor && nextRange.head === range.head) {
    return false;
  }

  const before = snapshotVerticalMotion(view);

  view.dispatch({
    selection: view.state.selection.replaceRange(nextRange),
    scrollIntoView: true,
    userEvent: "select",
  });

  const guardId = ++nextReverseScrollGuardId;
  pendingReverseScrollGuardIds.set(view, guardId);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      if (pendingReverseScrollGuardIds.get(view) !== guardId) return;

      const after = snapshotVerticalMotion(view);
      const traversedHeight = sumTraversedLineHeights(
        before.line,
        after.line,
        (lineNumber) => readLineHeight(view, lineNumber),
      );
      const correctedScrollTop = correctedReverseVerticalScrollTop(
        before,
        after,
        traversedHeight,
      );
      if (correctedScrollTop !== null && correctedScrollTop !== view.scrollDOM.scrollTop) {
        view.scrollDOM.scrollTop = correctedScrollTop;
      }
    });
  });

  return true;
}
