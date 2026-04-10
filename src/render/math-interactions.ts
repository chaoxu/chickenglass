import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  buildPointerSelection,
  isPlainPrimaryMouseEvent,
} from "../editor/mouse-selection-core";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { rangesIntersect } from "../lib/range-helpers";
import { _snapToTokenBoundary } from "./math-source";
import { editorFocusField } from "./focus-state";
import { isFocusedInlineRevealTarget } from "./inline-reveal-policy";

interface InlineMathSourceRange {
  readonly from: number;
  readonly to: number;
}

function findLocAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | undefined {
  const candidates = root.querySelectorAll<HTMLElement>("[data-loc-start]");
  if (candidates.length === 0) return undefined;

  let bestContaining: HTMLElement | null = null;
  let bestArea = Infinity;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const area = rect.width * rect.height;
      if (area < bestArea) {
        bestArea = area;
        bestContaining = el;
      }
    }
  }

  if (bestContaining) {
    const value = Number.parseInt(bestContaining.dataset.locStart ?? "", 10);
    if (Number.isFinite(value)) return value;
  }

  return undefined;
}

export function resolveClickToSourcePos(
  el: HTMLElement,
  event: MouseEvent,
  latex: string,
  sourceFrom: number,
  sourceTo: number,
  contentOffset: number,
): number {
  const contentFrom = sourceFrom + contentOffset;

  const locStart = findLocAtPoint(el, event.clientX, event.clientY);
  if (locStart !== undefined) {
    return Math.max(sourceFrom, Math.min(sourceTo, contentFrom + locStart));
  }

  const contentLen = sourceTo - contentFrom;
  if (contentLen > 0) {
    const rect = el.getBoundingClientRect();
    const fraction = rect.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      : 0;
    const raw = Math.round(contentFrom + fraction * contentLen);
    const snapped = _snapToTokenBoundary(latex, contentFrom, raw);
    return Math.max(sourceFrom, Math.min(sourceTo, snapped));
  }
  return sourceFrom;
}

function parseInlineMathSourceRange(el: HTMLElement): InlineMathSourceRange | undefined {
  const from = Number.parseInt(el.dataset.sourceFrom ?? "", 10);
  const to = Number.parseInt(el.dataset.sourceTo ?? "", 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return undefined;
  return { from, to };
}

function findInlineMathSourceRange(
  target: EventTarget | null,
): InlineMathSourceRange | undefined {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
    ? target.parentElement
    : null;
  const root = element?.closest<HTMLElement>(`.${CSS.mathInline}`);
  return root ? parseInlineMathSourceRange(root) : undefined;
}

function findInlineMathSourceRangeAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): InlineMathSourceRange | undefined {
  const { elementFromPoint } = view.dom.ownerDocument;
  if (typeof elementFromPoint !== "function") return undefined;
  const element = elementFromPoint.call(view.dom.ownerDocument, clientX, clientY);
  return findInlineMathSourceRange(element);
}

function collectRenderedInlineMathRanges(state: EditorState): InlineMathSourceRange[] {
  const ranges: InlineMathSourceRange[] = [];
  const focused = state.field(editorFocusField, false) ?? false;

  for (const region of state.field(documentAnalysisField).mathRegions) {
    if (region.isDisplay) continue;
    if (isFocusedInlineRevealTarget(state.selection.main, region, focused)) continue;
    ranges.push({ from: region.from, to: region.to });
  }

  return ranges;
}

function hasRenderedInlineMath(state: EditorState): boolean {
  const focused = state.field(editorFocusField, false) ?? false;

  for (const region of state.field(documentAnalysisField).mathRegions) {
    if (region.isDisplay) continue;
    if (isFocusedInlineRevealTarget(state.selection.main, region, focused)) continue;
    return true;
  }

  return false;
}

function snapPointerSelectionOverInlineMath(
  selection: EditorSelection,
  mathRanges: readonly InlineMathSourceRange[],
  hoveredMathRange?: InlineMathSourceRange,
): EditorSelection {
  let changed = false;

  const ranges = selection.ranges.map((range) => {
    if (range.empty) return range;

    const forward = range.head >= range.anchor;
    let from = Math.min(range.from, range.to);
    let to = Math.max(range.from, range.to);

    for (const mathRange of mathRanges) {
      if (rangesIntersect({ from, to }, mathRange)) {
        from = Math.min(from, mathRange.from);
        to = Math.max(to, mathRange.to);
      }
    }

    if (hoveredMathRange) {
      if (forward && from < hoveredMathRange.from && to === hoveredMathRange.from) {
        to = hoveredMathRange.to;
      } else if (
        !forward &&
        from === hoveredMathRange.to &&
        to > hoveredMathRange.to
      ) {
        from = hoveredMathRange.from;
      }
    }

    if (from === range.from && to === range.to) return range;

    changed = true;
    return forward ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
  });

  return changed ? EditorSelection.create(ranges, selection.mainIndex) : selection;
}

function createInlineMathMouseSelectionStyle(
  view: EditorView,
  startEvent: MouseEvent,
  initialStartMathRange?: InlineMathSourceRange,
) {
  let start = view.posAndSideAtCoords(
    { x: startEvent.clientX, y: startEvent.clientY },
    false,
  );
  const startSelection = view.state.selection;
  let startMathRange = initialStartMathRange;

  return {
    get(currentEvent: MouseEvent) {
      const current = view.posAndSideAtCoords(
        { x: currentEvent.clientX, y: currentEvent.clientY },
        false,
      );
      const hoveredMathRange = findInlineMathSourceRangeAtCoords(
        view,
        currentEvent.clientX,
        currentEvent.clientY,
      ) ?? findInlineMathSourceRange(currentEvent.target);
      const mathRanges = collectRenderedInlineMathRanges(view.state);

      if (startMathRange) {
        if (currentEvent === startEvent) return startSelection;

        if (current.pos <= startMathRange.from) {
          return snapPointerSelectionOverInlineMath(
            EditorSelection.create([
              EditorSelection.range(startMathRange.to, current.pos),
            ]),
            mathRanges,
            hoveredMathRange,
          );
        }
        if (current.pos >= startMathRange.to) {
          return snapPointerSelectionOverInlineMath(
            EditorSelection.create([
              EditorSelection.range(startMathRange.from, current.pos),
            ]),
            mathRanges,
            hoveredMathRange,
          );
        }

        return startSelection;
      }

      return snapPointerSelectionOverInlineMath(
        buildPointerSelection(start, current),
        mathRanges,
        hoveredMathRange,
      );
    },

    update(update: ViewUpdate) {
      if (!update.docChanged) return false;
      start = {
        pos: update.changes.mapPos(start.pos, start.assoc),
        assoc: start.assoc,
      };
      startMathRange = startMathRange
        ? {
            from: update.changes.mapPos(startMathRange.from, -1),
            to: update.changes.mapPos(startMathRange.to, 1),
          }
        : undefined;
      return false;
    },
  };
}

export const mathMouseSelectionStyle = EditorView.mouseSelectionStyle.of((view, event) => {
  if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return null;
  const startMathRange = findInlineMathSourceRangeAtCoords(
    view,
    event.clientX,
    event.clientY,
  ) ?? findInlineMathSourceRange(event.target);
  if (!startMathRange && !hasRenderedInlineMath(view.state)) return null;
  return createInlineMathMouseSelectionStyle(view, event, startMathRange);
});
