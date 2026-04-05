import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import {
  forceParsing,
  syntaxParserRunning,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { buildDecorations } from "./render-utils";

/**
 * Maps Lezer syntax node type names to HTML tag names.
 * These become `data-tag-name` attributes on `cm-line` elements,
 * enabling CSS selectors like `[data-tag-name="h1"]`.
 */
const TAG_NAME_MAP: Readonly<Record<string, string>> = {
  ATXHeading1: "h1",
  ATXHeading2: "h2",
  ATXHeading3: "h3",
  ATXHeading4: "h4",
  ATXHeading5: "h5",
  ATXHeading6: "h6",
  BulletList: "ul",
  OrderedList: "ol",
  FencedCode: "code",
  HorizontalRule: "hr",
  FencedDiv: "div",
  Paragraph: "p",
};

const TREE_ONLY_TAG_NAME_MAP: Readonly<Record<string, string>> = {
  BulletList: "ul",
  OrderedList: "ol",
  FencedCode: "code",
  HorizontalRule: "hr",
  Paragraph: "p",
};

const CONTAINER_NODE_TYPES = new Set(Object.keys(TAG_NAME_MAP));
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const LINE_DECORATION_BY_TAG = Object.freeze(Object.fromEntries(
  [...HEADING_TAGS, "ul", "ol", "code", "hr", "div", "p"].map((tag) => [
    tag,
    Decoration.line({ attributes: { "data-tag-name": tag } }),
  ]),
) as Record<string, Decoration>);

interface OrderedRange {
  readonly from: number;
  readonly to: number;
}

// Semantic slices are immutable arrays, so a WeakMap lets local dirty-window
// rebuilds reuse overlap-query metadata until the slice revision changes.
const orderedRangePrefixMaxToCache = new WeakMap<
  readonly OrderedRange[],
  readonly number[]
>();
const mergedRangeCoverageCache = new WeakMap<
  readonly OrderedRange[],
  readonly OrderedRange[]
>();

function clampDocPos(doc: Text, pos: number): number {
  return Math.max(0, Math.min(pos, doc.length));
}

function expandRangeToLineBounds(
  doc: Text,
  from: number,
  to: number,
): { from: number; to: number } {
  if (doc.length === 0) {
    return { from: 0, to: 0 };
  }

  const clampedFrom = clampDocPos(doc, from);
  const clampedTo = clampDocPos(doc, Math.max(from, to));

  return {
    from: doc.lineAt(clampedFrom).from,
    to: doc.lineAt(clampedTo).to,
  };
}

function expandChangeQueryRange(
  doc: Text,
  from: number,
  to: number,
): { from: number; to: number } {
  if (doc.length === 0) {
    return { from: 0, to: 0 };
  }

  return expandRangeToLineBounds(
    doc,
    from > 0 ? from - 1 : from,
    to < doc.length ? to + 1 : to,
  );
}

function rangesOverlap(
  valueFrom: number,
  valueTo: number,
  rangeFrom: number,
  rangeTo: number,
): boolean {
  return valueFrom <= rangeTo && rangeFrom <= valueTo;
}

function getOrderedRangePrefixMaxTo(
  values: readonly OrderedRange[],
): readonly number[] {
  const cached = orderedRangePrefixMaxToCache.get(values);
  if (cached) return cached;

  const prefixMaxTo = new Array<number>(values.length);
  let maxTo = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length; index++) {
    maxTo = Math.max(maxTo, values[index].to);
    prefixMaxTo[index] = maxTo;
  }

  orderedRangePrefixMaxToCache.set(values, prefixMaxTo);
  return prefixMaxTo;
}

function firstPotentialOverlapIndex(
  values: readonly OrderedRange[],
  rangeFrom: number,
): number {
  if (values.length === 0) {
    return -1;
  }

  const prefixMaxTo = getOrderedRangePrefixMaxTo(values);
  let lo = 0;
  let hi = prefixMaxTo.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (prefixMaxTo[mid] < rangeFrom) lo = mid + 1;
    else hi = mid;
  }

  return lo < values.length ? lo : -1;
}

function forEachOverlappingOrderedRange<T extends OrderedRange>(
  values: readonly T[],
  rangeFrom: number,
  rangeTo: number,
  visit: (value: T) => void,
): void {
  const startIndex = firstPotentialOverlapIndex(values, rangeFrom);
  if (startIndex === -1) {
    return;
  }

  for (let index = startIndex; index < values.length; index++) {
    const value = values[index];
    if (value.from > rangeTo) {
      break;
    }
    if (!rangesOverlap(value.from, value.to, rangeFrom, rangeTo)) {
      continue;
    }
    visit(value);
  }
}

function getMergedRangeCoverage(
  values: readonly OrderedRange[],
): readonly OrderedRange[] {
  const cached = mergedRangeCoverageCache.get(values);
  if (cached) return cached;
  if (values.length === 0) {
    return values;
  }

  const coverage: OrderedRange[] = [];
  let currentFrom = values[0].from;
  let currentTo = values[0].to;

  // Fenced divs all map to the same `div` line tag, so nested spans can be
  // queried as merged coverage rather than as individual semantic entries.
  for (let index = 1; index < values.length; index++) {
    const value = values[index];
    if (value.from <= currentTo) {
      currentTo = Math.max(currentTo, value.to);
      continue;
    }

    coverage.push({ from: currentFrom, to: currentTo });
    currentFrom = value.from;
    currentTo = value.to;
  }

  coverage.push({ from: currentFrom, to: currentTo });
  mergedRangeCoverageCache.set(values, coverage);
  return coverage;
}

function collectOverlappingOrderedRangesForTest<T extends OrderedRange>(
  values: readonly T[],
  rangeFrom: number,
  rangeTo: number,
): readonly T[] {
  const overlaps: T[] = [];
  forEachOverlappingOrderedRange(values, rangeFrom, rangeTo, (value) => {
    overlaps.push(value);
  });
  return overlaps;
}

function getMergedRangeCoverageForTest(
  values: readonly OrderedRange[],
): readonly OrderedRange[] {
  return getMergedRangeCoverage(values);
}

function assignLineTag(
  lineTagMap: Map<number, string>,
  state: EditorState,
  from: number,
  to: number,
  tagName: string,
  rangeFrom: number,
  rangeTo: number,
): void {
  if (!rangesOverlap(from, to, rangeFrom, rangeTo)) return;

  let lineStart = state.doc.lineAt(Math.max(from, rangeFrom)).from;
  const nodeEnd = Math.min(to, rangeTo);

  while (lineStart <= nodeEnd) {
    lineTagMap.set(lineStart, tagName);
    const line = state.doc.lineAt(lineStart);
    if (line.to >= nodeEnd) break;
    lineStart = line.to + 1;
  }
}

function collectLineTagsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
): Map<number, string> {
  const lineTagMap = new Map<number, string>();
  const semantics = state.field(documentSemanticsField, false);

  if (semantics) {
    forEachOverlappingOrderedRange(
      semantics.headings,
      rangeFrom,
      rangeTo,
      (heading) => {
        const tagName = HEADING_TAGS[heading.level - 1];
        if (!tagName) {
          return;
        }
        assignLineTag(
          lineTagMap,
          state,
          heading.from,
          heading.to,
          tagName,
          rangeFrom,
          rangeTo,
        );
      },
    );

    forEachOverlappingOrderedRange(
      getMergedRangeCoverage(semantics.fencedDivs),
      rangeFrom,
      rangeTo,
      (div) => {
        assignLineTag(
          lineTagMap,
          state,
          div.from,
          div.to,
          "div",
          rangeFrom,
          rangeTo,
        );
      },
    );
  }

  const treeTagMap = semantics ? TREE_ONLY_TAG_NAME_MAP : TAG_NAME_MAP;
  syntaxTree(state).iterate({
    from: rangeFrom,
    to: rangeTo,
    enter(node) {
      const tagName = treeTagMap[node.type.name];
      if (!tagName) return;
      assignLineTag(
        lineTagMap,
        state,
        node.from,
        node.to,
        tagName,
        rangeFrom,
        rangeTo,
      );
    },
  });

  return lineTagMap;
}

function buildContainerItemsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
): Range<Decoration>[] {
  const lineTagMap = collectLineTagsInRange(state, rangeFrom, rangeTo);
  const items: Range<Decoration>[] = [];
  const sortedPositions = [...lineTagMap.keys()].sort((a, b) => a - b);

  for (const pos of sortedPositions) {
    const tagName = lineTagMap.get(pos);
    if (!tagName) continue;
    items.push(LINE_DECORATION_BY_TAG[tagName].range(pos));
  }

  return items;
}

/**
 * Build a DecorationSet of `Decoration.line` decorations that add
 * `data-tag-name` attributes to each `cm-line` element covered by a
 * block-level syntax node.
 *
 * `Decoration.line` must be applied at the line-start position (from).
 * We iterate over every line that falls within each matching node and
 * apply the decoration to each line's start.
 */
function buildContainerDecorations(state: EditorState): DecorationSet {
  return buildDecorations(
    buildContainerItemsInRange(state, 0, state.doc.length),
  );
}

interface DirtyRegion {
  readonly filterFrom: number;
  readonly filterTo: number;
}

function mergeDirtyRegions(
  a: DirtyRegion | null,
  b: DirtyRegion | null,
): DirtyRegion | null {
  if (!a) return b;
  if (!b) return a;
  return {
    filterFrom: Math.min(a.filterFrom, b.filterFrom),
    filterTo: Math.max(a.filterTo, b.filterTo),
  };
}

function dirtyRegionsEqual(
  a: DirtyRegion | null,
  b: DirtyRegion | null,
): boolean {
  if (a === b) return true;
  return a?.filterFrom === b?.filterFrom && a?.filterTo === b?.filterTo;
}

function mapDirtyRegion(region: DirtyRegion, tr: Transaction): DirtyRegion {
  const mappedFrom = clampDocPos(tr.state.doc, tr.changes.mapPos(region.filterFrom, 1));
  const mappedTo = clampDocPos(
    tr.state.doc,
    Math.max(mappedFrom, tr.changes.mapPos(region.filterTo, -1)),
  );
  const mappedWindow = expandRangeToLineBounds(tr.state.doc, mappedFrom, mappedTo);
  return {
    filterFrom: mappedWindow.from,
    filterTo: mappedWindow.to,
  };
}

function computePendingDirtyRegion(
  tr: Transaction,
): DirtyRegion | null {
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;

  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const newWindow = expandChangeQueryRange(tr.state.doc, fromB, toB);
    filterFrom = Math.min(filterFrom, newWindow.from);
    filterTo = Math.max(filterTo, newWindow.to);
  }, true);

  if (filterFrom > filterTo) return null;
  return { filterFrom, filterTo };
}

function expandDirtyRegionWithTree(
  state: EditorState,
  dirty: DirtyRegion,
): DirtyRegion {
  let filterFrom = dirty.filterFrom;
  let filterTo = dirty.filterTo;

  syntaxTree(state).iterate({
    from: dirty.filterFrom,
    to: dirty.filterTo,
    enter(node) {
      if (!CONTAINER_NODE_TYPES.has(node.type.name)) return;
      const nodeWindow = expandRangeToLineBounds(state.doc, node.from, node.to);
      filterFrom = Math.min(filterFrom, nodeWindow.from);
      filterTo = Math.max(filterTo, nodeWindow.to);
    },
  });

  return { filterFrom, filterTo };
}

function computeContainerDirtyRegion(
  tr: Transaction,
): DirtyRegion | null {
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;

  const oldTree = syntaxTree(tr.startState);
  const newTree = syntaxTree(tr.state);

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const oldWindow = expandChangeQueryRange(tr.startState.doc, fromA, toA);
    const newWindow = expandChangeQueryRange(tr.state.doc, fromB, toB);

    filterFrom = Math.min(filterFrom, newWindow.from);
    filterTo = Math.max(filterTo, newWindow.to);

    oldTree.iterate({
      from: oldWindow.from,
      to: oldWindow.to,
      enter(node) {
        if (!CONTAINER_NODE_TYPES.has(node.type.name)) return;

        const mappedFrom = clampDocPos(tr.state.doc, tr.changes.mapPos(node.from, 1));
        const mappedTo = clampDocPos(
          tr.state.doc,
          Math.max(mappedFrom, tr.changes.mapPos(node.to, -1)),
        );
        const mappedWindow = expandRangeToLineBounds(
          tr.state.doc,
          mappedFrom,
          mappedTo,
        );
        filterFrom = Math.min(filterFrom, mappedWindow.from);
        filterTo = Math.max(filterTo, mappedWindow.to);
      },
    });

    newTree.iterate({
      from: newWindow.from,
      to: newWindow.to,
      enter(node) {
        if (!CONTAINER_NODE_TYPES.has(node.type.name)) return;

        const nodeWindow = expandRangeToLineBounds(
          tr.state.doc,
          node.from,
          node.to,
        );
        filterFrom = Math.min(filterFrom, nodeWindow.from);
        filterTo = Math.max(filterTo, nodeWindow.to);
      },
    });
  }, true);

  if (filterFrom > filterTo) return null;
  return { filterFrom, filterTo };
}

function replaceContainerDecorationsInRange(
  value: DecorationSet,
  state: EditorState,
  dirty: DirtyRegion,
): DecorationSet {
  const { filterFrom, filterTo } = dirty;
  const newItems = buildContainerItemsInRange(state, filterFrom, filterTo);

  return value.update({
    filterFrom,
    filterTo,
    filter: () => false,
    add: newItems,
    sort: true,
  });
}

function incrementalContainerUpdate(
  value: DecorationSet,
  tr: Transaction,
): DecorationSet {
  const mapped = value.map(tr.changes);
  const dirty = computeContainerDirtyRegion(tr);
  if (!dirty) return mapped;

  return replaceContainerDecorationsInRange(mapped, tr.state, dirty);
}

const containerAttributePendingDirtyRegionField = StateField.define<DirtyRegion | null>({
  create() {
    return null;
  },

  update(value, tr) {
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    const treeReady = !treeChanged || syntaxTreeAvailable(tr.state, tr.state.doc.length);
    const pendingDirtyRegion = tr.docChanged && value
      ? mapDirtyRegion(value, tr)
      : value;

    if (tr.docChanged) {
      if (treeChanged && treeReady) {
        return null;
      }

      return mergeDirtyRegions(
        pendingDirtyRegion,
        computePendingDirtyRegion(tr),
      );
    }

    if (treeChanged && treeReady) {
      return null;
    }

    return pendingDirtyRegion;
  },

  compare(a, b) {
    return dirtyRegionsEqual(a, b);
  },
});

/**
 * StateField that maintains a DecorationSet of `Decoration.line`
 * decorations for all block-level nodes, adding `data-tag-name`
 * attributes to the corresponding `cm-line` DOM elements.
 *
 * Uses mapped decoration updates for text edits and only rebuilds the
 * container-tag decorations inside the dirty structural span. This keeps
 * typing in large documents from paying a broad full-document rebuild cost
 * while still updating far-reaching block-boundary edits correctly.
 *
 * This enables CSS targeting such as:
 *   `.cm-line[data-tag-name="h1"] { ... }`
 */
export const containerAttributesField = StateField.define<DecorationSet>({
  create(state) {
    return buildContainerDecorations(state);
  },

  update(value, tr) {
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    const treeReady = !treeChanged || syntaxTreeAvailable(tr.state, tr.state.doc.length);
    const pendingDirtyRegion = tr.startState.field(
      containerAttributePendingDirtyRegionField,
      false,
    );

    if (tr.docChanged) {
      if (treeChanged && treeReady) {
        return incrementalContainerUpdate(value, tr);
      }

      return value.map(tr.changes);
    }

    if (treeChanged && treeReady) {
      if (pendingDirtyRegion) {
        return replaceContainerDecorationsInRange(
          value,
          tr.state,
          expandDirtyRegionWithTree(tr.state, pendingDirtyRegion),
        );
      }

      return buildContainerDecorations(tr.state);
    }

    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

class ContainerAttributeParsePlugin {
  private scheduled: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {}

  update(_update: ViewUpdate): void {
    if (this.view.state.field(containerAttributePendingDirtyRegionField, false)) {
      this.schedule();
    }
  }

  destroy(): void {
    if (this.scheduled !== null) {
      clearTimeout(this.scheduled);
      this.scheduled = null;
    }
  }

  private schedule(): void {
    if (this.scheduled !== null) return;
    if (!this.view.state.field(containerAttributePendingDirtyRegionField, false)) return;
    if (syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) return;

    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      if (!this.view.state.field(containerAttributePendingDirtyRegionField, false)) return;
      forceParsing(this.view, this.view.state.doc.length, 25);
      if (
        this.view.state.field(containerAttributePendingDirtyRegionField, false) &&
        !syntaxTreeAvailable(this.view.state, this.view.state.doc.length) &&
        syntaxParserRunning(this.view)
      ) {
        this.schedule();
      }
    }, 0);
  }
}

/** CM6 extension that adds `data-tag-name` attributes to `cm-line` elements. */
export const containerAttributesPlugin: Extension = [
  containerAttributePendingDirtyRegionField,
  containerAttributesField,
  ViewPlugin.fromClass(ContainerAttributeParsePlugin),
];

export {
  collectOverlappingOrderedRangesForTest as _collectOverlappingOrderedRangesForTest,
  getMergedRangeCoverageForTest as _getMergedRangeCoverageForTest,
  computeContainerDirtyRegion as _computeContainerDirtyRegionForTest,
};
