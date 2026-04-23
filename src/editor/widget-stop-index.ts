import { syntaxTree } from "@codemirror/language";
import { type EditorState } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import {
  type TableRange,
  findTablesInState,
} from "../state/table-discovery";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import {
  isStandaloneImageLine,
  readMarkdownImageContent,
} from "../state/markdown-image";

export type HiddenWidgetStopKind = "frontmatter" | "display-math" | "block-image";

export interface HiddenWidgetStop {
  readonly kind: HiddenWidgetStopKind;
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly endLine: number;
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

export interface NavigationStopQueryRange {
  readonly from: number;
  readonly to: number;
}

const widgetStopIndexCache = new WeakMap<EditorState, WidgetStopIndex>();

export const widgetStopIndexCleanupExtension = ViewPlugin.fromClass(class {
  constructor(readonly _view: EditorView) {}

  destroy(): void {
    // State-keyed canonical indexes are held in a WeakMap and need no DOM cleanup.
  }
});

function hiddenStopFromRange(
  state: EditorState,
  kind: HiddenWidgetStopKind,
  from: number,
  to: number,
): HiddenWidgetStop | null {
  const safeFrom = Math.max(0, Math.min(from, state.doc.length));
  const safeTo = Math.max(safeFrom, Math.min(to, state.doc.length));
  if (safeTo < safeFrom) return null;
  const endPos = safeTo > safeFrom ? safeTo - 1 : safeFrom;
  return {
    kind,
    from: safeFrom,
    to: safeTo,
    startLine: state.doc.lineAt(safeFrom).number,
    endLine: state.doc.lineAt(endPos).number,
  };
}

function collectFrontmatterStop(state: EditorState): HiddenWidgetStop | null {
  const frontmatter = state.field(frontmatterField, false);
  if (!frontmatter || frontmatter.end <= 0) return null;
  return hiddenStopFromRange(state, "frontmatter", 0, frontmatter.end);
}

function collectDisplayMathStops(state: EditorState): readonly HiddenWidgetStop[] {
  const analysis = state.field(documentAnalysisField, false);
  if (!analysis) return [];
  return analysis.analysis.mathRegions
    .filter((region) => region.isDisplay)
    .map((region) => hiddenStopFromRange(state, "display-math", region.from, region.to))
    .filter((stop): stop is HiddenWidgetStop => stop !== null);
}

function collectBlockImageStops(state: EditorState): readonly HiddenWidgetStop[] {
  const seen = new Set<string>();
  const stops: HiddenWidgetStop[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      if (!readMarkdownImageContent(state, node.node)) return;
      if (!isStandaloneImageLine(state, node.from, node.to)) return;
      const key = `${node.from}:${node.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      const stop = hiddenStopFromRange(state, "block-image", node.from, node.to);
      if (stop) stops.push(stop);
      return false;
    },
  });

  return stops;
}

function collectTableStops(
  state: EditorState,
): readonly TableStopCandidate[] {
  return findTablesInState(state)
    .map((table) => ({
      table,
      startLine: table.startLineNumber,
      endLine: state.doc.lineAt(Math.max(table.from, table.to - 1)).number,
    }));
}

function buildWidgetStopIndex(
  state: EditorState,
): WidgetStopIndex {
  const frontmatterStop = collectFrontmatterStop(state);
  const hiddenStops = [
    ...(frontmatterStop ? [frontmatterStop] : []),
    ...collectDisplayMathStops(state),
    ...collectBlockImageStops(state),
  ];
  const tableStops = collectTableStops(state);

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

export function disposeWidgetStopIndex(view: EditorView): void {
  // Compatibility hook for callers that previously disposed DOM observers.
  // The canonical index is keyed by EditorState and is garbage-collected.
  void view;
}

export function getWidgetStopIndex(
  view: EditorView,
  _extraRanges: readonly NavigationStopQueryRange[] = [],
): WidgetStopIndex {
  const cached = widgetStopIndexCache.get(view.state);
  if (cached) return cached;
  const index = buildWidgetStopIndex(view.state);
  widgetStopIndexCache.set(view.state, index);
  return index;
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
