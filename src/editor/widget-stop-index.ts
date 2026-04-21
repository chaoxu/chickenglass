import { type Text } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  type TableRange,
  findTablesInState,
} from "../state/table-discovery";
import { resolveLiveWidgetSourceRange } from "../render/source-widget";

export interface HiddenWidgetStop {
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly element: HTMLElement;
}

export interface TableStopCandidate {
  readonly table: TableRange;
  readonly startLine: number;
  readonly endLine: number;
}

export interface WidgetStopIndex {
  readonly hiddenStopsForward: readonly HiddenWidgetStop[];
  readonly hiddenStopsBackward: readonly HiddenWidgetStop[];
  readonly hiddenStopsBySpan: readonly HiddenWidgetStop[];
  readonly tableStopsForward: readonly TableStopCandidate[];
  readonly tableStopsBackward: readonly TableStopCandidate[];
  readonly tableStopsBySpan: readonly TableStopCandidate[];
}

interface CachedWidgetStopIndex {
  doc: Text;
  visibleKey: string;
  dirty: boolean;
  observer: MutationObserver | null;
  index: WidgetStopIndex;
}

interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

const emptyWidgetStopIndex: WidgetStopIndex = {
  hiddenStopsForward: [],
  hiddenStopsBackward: [],
  hiddenStopsBySpan: [],
  tableStopsForward: [],
  tableStopsBackward: [],
  tableStopsBySpan: [],
};

const widgetStopIndexCache = new WeakMap<EditorView, CachedWidgetStopIndex>();

function visibleRangesKey(
  view: EditorView,
  extraRanges: readonly VisibleRange[],
): string {
  const ranges = view.visibleRanges.length > 0
    ? view.visibleRanges
    : [view.viewport];
  return [...ranges, ...extraRanges].map((range) => `${range.from}:${range.to}`).join("|");
}

function currentVisibleRanges(
  view: EditorView,
  extraRanges: readonly VisibleRange[],
): readonly VisibleRange[] {
  const ranges = view.visibleRanges.length > 0 ? view.visibleRanges : [view.viewport];
  return [...ranges, ...extraRanges];
}

function rangeOverlapsVisibleRanges(
  from: number,
  to: number,
  ranges: readonly VisibleRange[],
): boolean {
  for (const range of ranges) {
    if (to < range.from) continue;
    if (from > range.to) continue;
    return true;
  }
  return false;
}

function parseWidgetSourcePos(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function isInlineVerticalMotionStopElement(
  el: HTMLElement,
): boolean {
  return el.classList.contains(CSS.mathInline) ||
    el.classList.contains(CSS.crossref) ||
    el.classList.contains(CSS.citation) ||
    el.classList.contains(CSS.linkRendered) ||
    el.classList.contains(CSS.referenceSource) ||
    el.classList.contains(CSS.mathSource) ||
    el.classList.contains(CSS.sourceDelimiter) ||
    el.classList.contains(CSS.inlineEditor) ||
    el.classList.contains(CSS.footnoteInline);
}

function readWidgetSourceRange(
  view: EditorView,
  el: HTMLElement,
): { readonly from: number; readonly to: number } | null {
  const liveRange = resolveLiveWidgetSourceRange(view, el);
  if (liveRange) return liveRange;

  const from = parseWidgetSourcePos(el.dataset.sourceFrom);
  const to = parseWidgetSourcePos(el.dataset.sourceTo);
  if (from === null || to === null || from < 0 || to < from) return null;
  return { from, to };
}

function collectHiddenWidgetStops(
  view: EditorView,
  visibleRanges: readonly VisibleRange[],
): readonly HiddenWidgetStop[] {
  const seen = new Set<string>();
  const stops: HiddenWidgetStop[] = [];
  const doc = view.state.doc;

  for (const el of view.contentDOM.querySelectorAll<HTMLElement>("[data-source-from][data-source-to]")) {
    if (isInlineVerticalMotionStopElement(el)) continue;

    const range = readWidgetSourceRange(view, el);
    if (!range) continue;
    const from = Math.min(range.from, doc.length);
    const to = Math.min(range.to, doc.length);
    if (to < from || !rangeOverlapsVisibleRanges(from, to, visibleRanges)) continue;

    const key = `${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const endPos = to > from ? to - 1 : from;
    stops.push({
      from,
      to,
      startLine: doc.lineAt(from).number,
      endLine: doc.lineAt(endPos).number,
      element: el,
    });
  }

  return stops;
}

function collectTableStops(
  view: EditorView,
  visibleRanges: readonly VisibleRange[],
): readonly TableStopCandidate[] {
  return findTablesInState(view.state)
    .filter((table) => rangeOverlapsVisibleRanges(table.from, table.to, visibleRanges))
    .map((table) => ({
      table,
      startLine: table.startLineNumber,
      endLine: view.state.doc.lineAt(Math.max(table.from, table.to - 1)).number,
    }));
}

function buildWidgetStopIndex(
  view: EditorView,
  extraRanges: readonly VisibleRange[],
): WidgetStopIndex {
  const visibleRanges = currentVisibleRanges(view, extraRanges);
  const hiddenStops = collectHiddenWidgetStops(view, visibleRanges);
  const tableStops = collectTableStops(view, visibleRanges);

  return {
    hiddenStopsForward: [...hiddenStops].sort((left, right) => {
      if (left.startLine !== right.startLine) return left.startLine - right.startLine;
      if (left.from !== right.from) return left.from - right.from;
      return left.to - right.to;
    }),
    hiddenStopsBackward: [...hiddenStops].sort((left, right) => {
      if (left.endLine !== right.endLine) return right.endLine - left.endLine;
      if (left.to !== right.to) return right.to - left.to;
      return right.from - left.from;
    }),
    hiddenStopsBySpan: [...hiddenStops].sort((left, right) => {
      const leftSpan = left.to - left.from;
      const rightSpan = right.to - right.from;
      return leftSpan - rightSpan || left.from - right.from;
    }),
    tableStopsForward: [...tableStops].sort((left, right) => {
      if (left.startLine !== right.startLine) return left.startLine - right.startLine;
      return left.table.from - right.table.from;
    }),
    tableStopsBackward: [...tableStops].sort((left, right) => {
      if (left.endLine !== right.endLine) return right.endLine - left.endLine;
      return right.table.to - left.table.to;
    }),
    tableStopsBySpan: [...tableStops].sort((left, right) => {
      const leftSpan = left.table.to - left.table.from;
      const rightSpan = right.table.to - right.table.from;
      return leftSpan - rightSpan || left.table.from - right.table.from;
    }),
  };
}

function ensureDomObserver(
  view: EditorView,
  cached: CachedWidgetStopIndex,
): void {
  if (cached.observer || typeof MutationObserver === "undefined") return;

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "childList")) {
      cached.dirty = true;
    }
  });
  observer.observe(view.contentDOM, { childList: true, subtree: true });
  cached.observer = observer;
}

export function getWidgetStopIndex(
  view: EditorView,
  extraRanges: readonly VisibleRange[] = [],
): WidgetStopIndex {
  if (!view.dom.isConnected) return emptyWidgetStopIndex;

  const cached = widgetStopIndexCache.get(view);
  const visibleKey = visibleRangesKey(view, extraRanges);
  if (
    cached &&
    !cached.dirty &&
    cached.doc === view.state.doc &&
    cached.visibleKey === visibleKey
  ) {
    return cached.index;
  }

  const nextCached: CachedWidgetStopIndex = cached ?? {
    doc: view.state.doc,
    visibleKey,
    dirty: false,
    observer: null,
    index: emptyWidgetStopIndex,
  };
  nextCached.doc = view.state.doc;
  nextCached.visibleKey = visibleKey;
  nextCached.dirty = false;
  nextCached.index = buildWidgetStopIndex(view, extraRanges);
  ensureDomObserver(view, nextCached);
  widgetStopIndexCache.set(view, nextCached);
  return nextCached.index;
}

export function firstHiddenWidgetStopBetweenLines(
  index: WidgetStopIndex,
  fromLine: number,
  targetLine: number,
  forward: boolean,
): HiddenWidgetStop | null {
  const hiddenLineStart = Math.min(fromLine, targetLine) + 1;
  const hiddenLineEnd = Math.max(fromLine, targetLine) - 1;
  if (hiddenLineStart > hiddenLineEnd) return null;

  const candidates = forward
    ? index.hiddenStopsForward
    : index.hiddenStopsBackward;
  return candidates.find((candidate) =>
    candidate.endLine >= hiddenLineStart && candidate.startLine <= hiddenLineEnd
  ) ?? null;
}

export function hiddenWidgetStopAtPos(
  index: WidgetStopIndex,
  pos: number,
): HiddenWidgetStop | null {
  return index.hiddenStopsBySpan.find((candidate) =>
    pos >= candidate.from &&
    (candidate.to === candidate.from ? pos === candidate.to : pos < candidate.to)
  ) ?? null;
}

export function firstTableStopBetweenLines(
  index: WidgetStopIndex,
  fromLine: number,
  targetLine: number,
  forward: boolean,
): TableRange | null {
  const hiddenLineStart = Math.min(fromLine, targetLine) + 1;
  const hiddenLineEnd = Math.max(fromLine, targetLine) - 1;
  if (hiddenLineStart > hiddenLineEnd) return null;

  const candidates = forward
    ? index.tableStopsForward
    : index.tableStopsBackward;
  return candidates.find((candidate) =>
    candidate.endLine >= hiddenLineStart && candidate.startLine <= hiddenLineEnd
  )?.table ?? null;
}

export function tableStopAtPos(
  index: WidgetStopIndex,
  pos: number,
): TableRange | null {
  return index.tableStopsBySpan.find((candidate) =>
    pos >= candidate.table.from && pos < candidate.table.to
  )?.table ?? null;
}
