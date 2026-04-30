import {
  Decoration,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, type Range, type Extension, type Transaction } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import {
  normalizeDirtyRange,
  type VisibleRange,
  mergeRanges,
} from "./viewport-diff";
import {
  buildDecorations,
} from "./decoration-core";
import { createLifecycleDecorationStateField } from "./decoration-field";
import { containsRange } from "../lib/range-helpers";
import {
  clearLinkDecorationCacheForTest,
  linkDecorationCacheSizeForTest,
  openRenderedLinkAtEvent,
} from "./link-handler";
import {
  CURSOR_SENSITIVE_NODES,
  MARKDOWN_HANDLERS,
  type MarkdownHandlerContext,
} from "./markdown-render-handlers";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";

const MARKDOWN_LAYOUT_PARSE_TIMEOUT_MS = 1000;

function markdownLayoutTree(state: EditorState): Tree {
  return ensureSyntaxTree(
    state,
    state.doc.length,
    MARKDOWN_LAYOUT_PARSE_TIMEOUT_MS,
  ) ?? syntaxTree(state);
}

function uniqueNodeKey(node: SyntaxNodeRef): string {
  return `${node.name}:${node.from}:${node.to}`;
}

function nodeRangeKey(node: SyntaxNodeRef): string {
  return `${node.from}:${node.to}`;
}

function iterateTreeUnique(
  tree: Tree,
  options: {
    readonly from: number;
    readonly to: number;
    readonly key?: (node: SyntaxNodeRef) => string;
    readonly seen?: Set<string>;
    readonly enter: (node: SyntaxNodeRef) => false | undefined;
  },
): void {
  const seenNodes = options.seen ?? new Set<string>();
  const keyForNode = options.key ?? uniqueNodeKey;
  tree.iterate({
    from: options.from,
    to: options.to,
    enter(node) {
      const key = keyForNode(node);
      if (seenNodes.has(key)) return undefined;
      seenNodes.add(key);
      return options.enter(node);
    },
  });
}

function mapNodeRange(
  changes: Transaction["changes"],
  state: EditorState,
  from: number,
  to: number,
): VisibleRange {
  return normalizeDirtyRange(
    changes.mapPos(from, 1),
    changes.mapPos(to, -1),
    state.doc.length,
  );
}

function collectMarkdownDirtyRangesInState(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
  pushRange: (from: number, to: number) => void,
): void {
  const tree = markdownLayoutTree(state);
  const seenRanges = new Set<string>();
  const pushUniqueRange = (from: number, to: number) => {
    const key = `${from}:${to}`;
    if (seenRanges.has(key)) return;
    seenRanges.add(key);
    pushRange(from, to);
  };

  iterateTreeUnique(tree, {
    from: rangeFrom,
    to: rangeTo,
    key: nodeRangeKey,
    enter(node) {
      if (MARKDOWN_HANDLERS.has(node.name)) {
        pushUniqueRange(node.from, node.to);
      }
      return undefined;
    },
  });

  const positions = rangeFrom === rangeTo ? [rangeFrom] : [rangeFrom, rangeTo];
  for (const pos of positions) {
    const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(clampedPos, side);
      while (true) {
        if (MARKDOWN_HANDLERS.has(node.name)) {
          pushUniqueRange(node.from, node.to);
        }
        const parent = node.parent;
        if (!parent) break;
        node = parent;
      }
    }
  }
}

interface CursorContextEntry extends VisibleRange {
  readonly key: string;
}

interface CursorContextSnapshot {
  readonly key: string;
  readonly entries: readonly CursorContextEntry[];
}

function collectCursorContextSnapshot(
  state: EditorState,
  focused = true,
): CursorContextSnapshot {
  if (!focused) {
    return { key: "", entries: [] };
  }

  const { from, to } = state.selection.main;
  const tree = markdownLayoutTree(state);
  const entriesByKey = new Map<string, CursorContextEntry>();

  const positions = from === to ? [from] : [from, to];
  for (const pos of positions) {
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(pos, side);
      while (node.parent) {
        if (
          CURSOR_SENSITIVE_NODES.has(node.name) &&
          containsRange(node, { from, to })
        ) {
          const key = `${node.name}:${node.from}:${node.to}`;
          if (!entriesByKey.has(key)) {
            entriesByKey.set(key, { key, from: node.from, to: node.to });
          }
        }
        node = node.parent;
      }
    }
  }

  const entries = [...entriesByKey.values()].sort((a, b) =>
    a.from - b.from || a.to - b.to || a.key.localeCompare(b.key)
  );
  return {
    key: entries.length === 0
      ? ""
      : entries.length === 1
        ? entries[0].key
        : entries.map((entry) => entry.key).join("|"),
    entries,
  };
}

const cursorChangeRangeCache = new WeakMap<ViewUpdate, readonly VisibleRange[]>();

function focusStates(update: ViewUpdate): { readonly startFocused: boolean; readonly endFocused: boolean } {
  const endFocused = update.view.hasFocus;
  return {
    startFocused: update.focusChanged ? !endFocused : endFocused,
    endFocused,
  };
}

function markdownDocChangeNeedsContextMerge(update: ViewUpdate): boolean {
  return update.focusChanged || !update.state.selection.eq(update.startState.selection);
}

function computeMarkdownContextChangeRangesBetween(
  startState: EditorState,
  state: EditorState,
  changes: Transaction["changes"],
  startFocused: boolean,
  endFocused: boolean,
): readonly VisibleRange[] {
  const startContext = collectCursorContextSnapshot(startState, startFocused);
  const endContext = collectCursorContextSnapshot(state, endFocused);

  if (startContext.key === endContext.key) {
    return [];
  }

  const nextEntries = new Map(endContext.entries.map((entry) => [entry.key, entry] as const));
  const dirtyRanges: VisibleRange[] = [];

  for (const entry of startContext.entries) {
    if (!nextEntries.has(entry.key)) {
      dirtyRanges.push(mapNodeRange(changes, state, entry.from, entry.to));
    }
  }

  const previousKeys = new Set(startContext.entries.map((entry) => entry.key));
  for (const entry of endContext.entries) {
    if (!previousKeys.has(entry.key)) {
      dirtyRanges.push(normalizeDirtyRange(entry.from, entry.to, state.doc.length));
    }
  }

  return mergeRanges(dirtyRanges);
}

export function computeMarkdownContextChangeRanges(
  update: ViewUpdate,
): readonly VisibleRange[] {
  const cached = cursorChangeRangeCache.get(update);
  if (cached) return cached;

  const { startFocused, endFocused } = focusStates(update);
  const mergedDirtyRanges = computeMarkdownContextChangeRangesBetween(
    update.startState,
    update.state,
    update.changes,
    startFocused,
    endFocused,
  );
  cursorChangeRangeCache.set(update, mergedDirtyRanges);
  return mergedDirtyRanges;
}

function stateFocus(state: EditorState): boolean {
  return state.field(editorFocusField, false) ?? false;
}

function computeMarkdownContextChangeRangesForTransaction(
  tr: Transaction,
): readonly VisibleRange[] {
  return computeMarkdownContextChangeRangesBetween(
    tr.startState,
    tr.state,
    tr.changes,
    stateFocus(tr.startState),
    stateFocus(tr.state),
  );
}

function markdownCursorContextChanged(update: ViewUpdate): boolean {
  return computeMarkdownContextChangeRanges(update).length > 0;
}

/**
 * Return a key identifying all cursor-sensitive nodes that contain the
 * primary selection. Changes in this key mean the cursor crossed a
 * node boundary that affects marker visibility.
 *
 * Checks both resolve directions at each selection endpoint to handle
 * inclusive-end boundaries (cursorInRange uses pos <= node.to).
 */
export function cursorContextKey(state: EditorState): string {
  return collectCursorContextSnapshot(state).key;
}

/**
 * Narrowed shouldUpdate for markdown-render (#579).
 *
 * Rebuilds on structural changes (doc, tree, viewport) unconditionally.
 * For selection/focus changes, only rebuilds when the cursor context crosses
 * a cursor-sensitive node boundary — i.e., moved into, out of, or between
 * nodes that toggle marker visibility, or when focus changes whether those
 * nodes should render as source.
 */
export function markdownShouldUpdate(update: ViewUpdate): boolean {
  if (
    update.docChanged ||
    update.viewportChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  ) {
    return true;
  }

  if (update.selectionSet || update.focusChanged) {
    return markdownCursorContextChanged(update);
  }

  return false;
}

/**
 * Dirty-range narrowing for markdown doc changes (#823).
 *
 * Expands literal edits to any markdown-rendered nodes that overlap the change
 * in the old or new tree so mapped decorations outside those fragments stay
 * valid, and merges in any local cursor/focus context changes for the same
 * transaction.
 */
export function computeMarkdownDocChangeRanges(
  update: ViewUpdate,
): readonly VisibleRange[] | null {
  const dirtyRanges = markdownDocChangeNeedsContextMerge(update)
    ? [...computeMarkdownContextChangeRanges(update)]
    : [];
  const pushRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, update.state.doc.length));
  };

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    collectMarkdownDirtyRangesInState(update.startState, fromA, toA, (nodeFrom, nodeTo) => {
      dirtyRanges.push(mapNodeRange(update.changes, update.state, nodeFrom, nodeTo));
    });
    collectMarkdownDirtyRangesInState(update.state, fromB, toB, pushRange);
  });

  return mergeRanges(dirtyRanges);
}

function markdownTransactionNeedsContextMerge(tr: Transaction): boolean {
  return (
    stateFocus(tr.startState) !== stateFocus(tr.state) ||
    !tr.state.selection.eq(tr.startState.selection)
  );
}

function computeMarkdownDocChangeRangesForTransaction(
  tr: Transaction,
): readonly VisibleRange[] | null {
  const dirtyRanges = markdownTransactionNeedsContextMerge(tr)
    ? [...computeMarkdownContextChangeRangesForTransaction(tr)]
    : [];
  const pushRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, tr.state.doc.length));
  };

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    collectMarkdownDirtyRangesInState(tr.startState, fromA, toA, (nodeFrom, nodeTo) => {
      dirtyRanges.push(mapNodeRange(tr.changes, tr.state, nodeFrom, nodeTo));
    });
    collectMarkdownDirtyRangesInState(tr.state, fromB, toB, pushRange);
  });

  return mergeRanges(dirtyRanges);
}

/**
 * Collect markdown decoration ranges (headings, emphasis, links, etc.).
 *
 * Dispatches each node to its registered handler via MARKDOWN_HANDLERS.
 * Each handler has per-type semantics: some always apply styles, some
 * toggle marker visibility, some skip children entirely.
 *
 * Incremental callers pass `skip(node.from)` for retained boundary nodes.
 * Markdown applies that only to the node itself and still walks children so
 * local rebuilds can update nested dirty descendants without duplicating the
 * parent decorations.
 */
function collectMarkdownItemsForState(
  state: EditorState,
  focused: boolean,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const ctx: MarkdownHandlerContext = {
    state,
    focused,
    items: [],
    cursorInHeading: false,
  };
  const tree = markdownLayoutTree(state);
  const seenNodes = new Set<string>();

  for (const { from, to } of ranges) {
    iterateTreeUnique(tree, {
      from,
      to,
      seen: seenNodes,
      enter(node) {
        const handler = MARKDOWN_HANDLERS.get(node.name);
        if (!handler) return undefined;
        if (skip(node.from) && node.from < from) {
          return undefined;
        }
        return handler.handle(node, ctx) === false ? false : undefined;
      },
    });
  }

  return ctx.items;
}

function collectMarkdownItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  return collectMarkdownItemsForState(view.state, view.hasFocus, ranges, skip);
}

function buildMarkdownDecorationsFromState(state: EditorState) {
  return buildDecorations(
    collectMarkdownItemsForState(
      state,
      stateFocus(state),
      [{ from: 0, to: state.doc.length }],
      () => false,
    ),
  );
}

export { collectMarkdownItems as _collectMarkdownItemsForTest };
export { markdownDocChangeNeedsContextMerge as _markdownDocChangeNeedsContextMergeForTest };
export function _clearLinkDecorationCacheForTest(): void {
  clearLinkDecorationCacheForTest();
}
export function _linkDecorationCacheSizeForTest(): number {
  return linkDecorationCacheSizeForTest();
}

const markdownDecorationField = createLifecycleDecorationStateField({
  spanName: "cm6.markdownRender",
  build: buildMarkdownDecorationsFromState,
  collectRanges(state, dirtyRanges) {
    return collectMarkdownItemsForState(
      state,
      stateFocus(state),
      dirtyRanges,
      () => false,
    );
  },
  semanticChanged(beforeState, afterState) {
    return syntaxTree(afterState) !== syntaxTree(beforeState);
  },
  contextChanged(tr) {
    return computeMarkdownContextChangeRangesForTransaction(tr).length > 0;
  },
  contextUpdateMode: "dirty-ranges",
  dirtyRangeFn(tr, context) {
    if (context.docChanged) {
      return computeMarkdownDocChangeRangesForTransaction(tr);
    }
    if (context.contextChanged) {
      return computeMarkdownContextChangeRangesForTransaction(tr);
    }
    return [];
  },
});

const renderedLinkEventHandlers = EditorView.domEventHandlers({
  click: openRenderedLinkAtEvent,
});

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  markdownDecorationField,
  renderedLinkEventHandlers,
];
