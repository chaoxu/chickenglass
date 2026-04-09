import { syntaxTree } from "@codemirror/language";
import {
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginSpec,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { buildDecorations } from "./decoration-core";
import {
  diffVisibleRanges,
  isPositionInRanges,
  mapVisibleRanges,
  mergeRanges,
  rangeIntersectsRanges,
  snapshotRanges,
  type VisibleRange,
} from "./viewport-diff";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

/**
 * Default update predicate for render ViewPlugins.
 *
 * Returns true only for structural changes: docChanged or syntaxTree changed.
 */
export function defaultShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  );
}

/**
 * Cursor-sensitive update predicate for render ViewPlugins.
 *
 * Returns true for structural changes plus selection, focus, and viewport
 * changes for plugins that render based on cursor proximity or visible ranges.
 */
export function cursorSensitiveShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.focusChanged ||
    update.viewportChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  );
}

function filterDecorationSetInRanges(
  decorations: DecorationSet,
  filterRanges: readonly VisibleRange[],
  keep: (from: number, to: number) => boolean,
): DecorationSet {
  let nextDecorations = decorations;
  for (const range of filterRanges) {
    nextDecorations = nextDecorations.update({
      filterFrom: range.from,
      filterTo: range.to,
      filter: (from, to) => keep(from, to),
    });
  }
  return nextDecorations;
}

function collectDecorationStartsInRanges(
  decorations: DecorationSet,
  ranges: readonly VisibleRange[],
  excludeRanges: readonly VisibleRange[] = [],
): ReadonlySet<number> {
  const starts = new Set<number>();
  for (const range of ranges) {
    decorations.between(range.from, range.to, (from) => {
      if (excludeRanges.length > 0 && isPositionInRanges(from, excludeRanges)) {
        return;
      }
      starts.add(from);
    });
  }
  return starts;
}

const NO_SKIP = () => false;

/**
 * Collect function signature for cursor-sensitive view plugins.
 */
export type CursorSensitiveCollectFn = (
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
) => Range<Decoration>[];

/**
 * Optional doc-change invalidation callback for cursor-sensitive view plugins.
 */
export type CursorSensitiveDocChangeRangesFn = (
  update: ViewUpdate,
) => readonly VisibleRange[] | null;

/**
 * Optional selection/focus invalidation callback for cursor-sensitive view plugins.
 */
export type CursorSensitiveContextChangeRangesFn = (
  update: ViewUpdate,
) => readonly VisibleRange[] | null;

/**
 * Factory for cursor-sensitive ViewPlugins with differential viewport updates.
 */
export function createCursorSensitiveViewPlugin(
  collectFn: CursorSensitiveCollectFn,
  options?: {
    selectionCheck?: (update: ViewUpdate) => boolean;
    contextChangeRanges?: CursorSensitiveContextChangeRangesFn;
    docChangeRanges?: CursorSensitiveDocChangeRangesFn;
    /** How to handle viewport-only updates when no doc/context work is needed. */
    onViewportOnly?: "incremental" | "skip";
    extraRebuildCheck?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
  },
): Extension {
  class CursorSensitivePlugin implements PluginValue {
    decorations!: DecorationSet;
    private coveredRanges!: VisibleRange[];

    constructor(view: EditorView) {
      this.rebuild(view);
    }

    private rebuild(view: EditorView): void {
      const items = collectFn(view, view.visibleRanges, NO_SKIP);
      this.decorations = buildDecorations(items);
      this.coveredRanges = snapshotRanges(view.visibleRanges);
    }

    private updateVisibleRanges(
      view: EditorView,
      baseDecorations: DecorationSet,
      previousCoveredRanges: readonly VisibleRange[],
      dirtyRanges: readonly VisibleRange[],
    ): void {
      const currentVisibleRanges = snapshotRanges(view.visibleRanges);
      const visibleDirtyRanges = mergeRanges(
        dirtyRanges.filter((range) =>
          rangeIntersectsRanges(range.from, range.to, currentVisibleRanges)
        ),
      );
      const staleRanges = diffVisibleRanges(currentVisibleRanges, previousCoveredRanges);
      const missingVisible = diffVisibleRanges(previousCoveredRanges, currentVisibleRanges);
      const rebuildRanges = mergeRanges([...visibleDirtyRanges, ...missingVisible]);
      const filterRanges = mergeRanges([...visibleDirtyRanges, ...staleRanges]);

      let nextDecorations = filterRanges.length > 0
        ? filterDecorationSetInRanges(
            baseDecorations,
            filterRanges,
            (from, to) =>
              rangeIntersectsRanges(from, to, currentVisibleRanges) &&
              !rangeIntersectsRanges(from, to, visibleDirtyRanges),
          )
        : baseDecorations;

      if (rebuildRanges.length > 0) {
        const retainedStarts = collectDecorationStartsInRanges(
          nextDecorations,
          currentVisibleRanges,
          visibleDirtyRanges,
        );
        const skip = (pos: number) => retainedStarts.has(pos);
        const newItems = collectFn(view, rebuildRanges, skip);
        if (newItems.length > 0) {
          nextDecorations = nextDecorations.update({
            add: newItems,
            sort: true,
          });
        }
      }

      this.decorations = nextDecorations;
      this.coveredRanges = currentVisibleRanges;
    }

    private skipViewportOnlyUpdate(): boolean {
      return options?.onViewportOnly === "skip";
    }

    private incrementalViewportUpdate(update: ViewUpdate): void {
      this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, []);
    }

    private incrementalDocUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      const mappedCoveredRanges = mapVisibleRanges(this.coveredRanges, update.changes);
      this.updateVisibleRanges(
        update.view,
        this.decorations.map(update.changes),
        mappedCoveredRanges,
        dirtyRanges,
      );
    }

    private incrementalContextUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, dirtyRanges);
    }

    update(update: ViewUpdate): void {
      const programmaticDocRewrite = (update.transactions ?? []).some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation) === true
      );
      if (programmaticDocRewrite) {
        this.rebuild(update.view);
        return;
      }

      const contextDirtyRanges = options?.contextChangeRanges?.(update);
      const selectionNeedsRebuild = contextDirtyRanges === undefined
        ? (options?.selectionCheck ? options.selectionCheck(update) : update.selectionSet)
        : contextDirtyRanges === null;
      const extraNeedsRebuild = options?.extraRebuildCheck?.(update) ?? false;

      if (update.docChanged) {
        const docDirtyRanges = options?.docChangeRanges?.(update);
        let dirtyRanges: readonly VisibleRange[] | null | undefined;
        if (docDirtyRanges === undefined) {
          dirtyRanges = undefined;
        } else if (contextDirtyRanges === undefined || docDirtyRanges === null) {
          dirtyRanges = docDirtyRanges;
        } else if (contextDirtyRanges === null) {
          dirtyRanges = null;
        } else {
          dirtyRanges = mergeRanges([...docDirtyRanges, ...contextDirtyRanges]);
        }
        const needsFullRebuild =
          selectionNeedsRebuild ||
          (contextDirtyRanges === undefined && update.focusChanged) ||
          extraNeedsRebuild ||
          dirtyRanges === null ||
          dirtyRanges === undefined;

        if (needsFullRebuild) {
          this.rebuild(update.view);
          return;
        }

        if (dirtyRanges === null || dirtyRanges === undefined) {
          this.rebuild(update.view);
          return;
        }

        this.incrementalDocUpdate(update, dirtyRanges);
        return;
      }

      if (
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        extraNeedsRebuild
      ) {
        this.rebuild(update.view);
        return;
      }

      if (contextDirtyRanges !== undefined) {
        if (contextDirtyRanges === null) {
          this.rebuild(update.view);
          return;
        }
        if (contextDirtyRanges.length > 0) {
          this.incrementalContextUpdate(update, contextDirtyRanges);
          return;
        }
        if (update.viewportChanged && !this.skipViewportOnlyUpdate()) {
          this.incrementalContextUpdate(update, contextDirtyRanges);
        }
        return;
      }

      if (selectionNeedsRebuild || update.focusChanged) {
        this.rebuild(update.view);
        return;
      }

      if (update.viewportChanged && !this.skipViewportOnlyUpdate()) {
        this.incrementalViewportUpdate(update);
      }
    }
  }

  return ViewPlugin.fromClass(CursorSensitivePlugin, {
    ...options?.pluginSpec,
    decorations: (value) => value.decorations,
  });
}

/**
 * Factory that creates a CM6 ViewPlugin producing DecorationSet.
 */
export function createSimpleViewPlugin(
  buildFn: (view: EditorView) => DecorationSet,
  options?: {
    shouldUpdate?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
  },
): Extension {
  const shouldUpdate = options?.shouldUpdate ?? defaultShouldUpdate;

  class SimpleViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFn(view);
    }

    update(update: ViewUpdate): void {
      if (shouldUpdate(update)) {
        this.decorations = buildFn(update.view);
      }
    }
  }

  return ViewPlugin.fromClass(SimpleViewPlugin, {
    ...options?.pluginSpec,
    decorations: (value) => value.decorations,
  });
}
