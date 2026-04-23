import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
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
import { measureSync } from "../lib/perf";
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

export interface DecorationRangeBounds {
  readonly from: number;
  readonly to: number;
}

export function filterDecorationSetInRanges<T extends DecorationRangeBounds>(
  decorations: DecorationSet,
  filterRanges: readonly T[],
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

function measurePluginBranch<T>(
  spanName: string | undefined,
  branch: string,
  task: () => T,
): T {
  return spanName ? measureSync(`${spanName}.${branch}`, task) : task();
}

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

export type IncrementalDecorationsRangeFn<T extends DecorationRangeBounds> = (
  update: ViewUpdate,
) => readonly T[] | null;

export interface SemanticSensitiveUpdateContext {
  readonly docChanged: boolean;
  readonly semanticChanged: boolean;
  readonly contextChanged: boolean;
}

export type SemanticSensitiveUpdatePlan<T extends DecorationRangeBounds> =
  | { readonly kind: "keep" }
  | { readonly kind: "map" }
  | { readonly kind: "rebuild" }
  | { readonly kind: "dirty"; readonly dirtyRanges: readonly T[] };

export interface SemanticSensitiveUpdatePlanOptions<
  TUpdate,
  TRange extends DecorationRangeBounds,
> {
  readonly docChanged: (update: TUpdate) => boolean;
  readonly semanticChanged: (update: TUpdate) => boolean;
  readonly contextChanged?: (update: TUpdate) => boolean;
  readonly stableDocChangeMode?: "keep" | "map";
  readonly shouldRebuild?: (
    update: TUpdate,
    context: SemanticSensitiveUpdateContext,
  ) => boolean;
  readonly dirtyRanges?: (
    update: TUpdate,
    context: SemanticSensitiveUpdateContext,
  ) => readonly TRange[] | null;
  readonly contextUpdateMode?: "rebuild" | "dirty-ranges";
}

export function planSemanticSensitiveUpdate<
  TUpdate,
  TRange extends DecorationRangeBounds,
>(
  update: TUpdate,
  options: SemanticSensitiveUpdatePlanOptions<TUpdate, TRange>,
): SemanticSensitiveUpdatePlan<TRange> {
  const context: SemanticSensitiveUpdateContext = {
    docChanged: options.docChanged(update),
    semanticChanged: options.semanticChanged(update),
    contextChanged: options.contextChanged?.(update) ?? false,
  };

  if (options.shouldRebuild?.(update, context)) {
    return { kind: "rebuild" };
  }

  if (!context.docChanged) {
    if (context.semanticChanged) {
      return { kind: "rebuild" };
    }
    if (!context.contextChanged) {
      return { kind: "keep" };
    }
    if ((options.contextUpdateMode ?? "rebuild") === "rebuild") {
      return { kind: "rebuild" };
    }

    const dirtyRanges = options.dirtyRanges?.(update, context);
    if (dirtyRanges === null || dirtyRanges === undefined) {
      return { kind: "rebuild" };
    }
    if (dirtyRanges.length === 0) {
      return { kind: "keep" };
    }
    return { kind: "dirty", dirtyRanges };
  }

  if (!context.semanticChanged && !context.contextChanged) {
    return { kind: options.stableDocChangeMode ?? "map" };
  }

  const dirtyRanges = options.dirtyRanges?.(update, context);
  if (dirtyRanges === null || dirtyRanges === undefined) {
    return { kind: "rebuild" };
  }
  if (dirtyRanges.length === 0) {
    return { kind: "map" };
  }
  return { kind: "dirty", dirtyRanges };
}

/**
 * Factory for ViewPlugins that rebuild only dirty ranges and otherwise map
 * existing decorations through doc changes.
 */
export function createIncrementalDecorationsViewPlugin<
  T extends DecorationRangeBounds = DecorationRangeBounds,
>(
  buildFn: (view: EditorView) => DecorationSet,
  options: {
    incrementalRanges: IncrementalDecorationsRangeFn<T>;
    collectRanges: (view: EditorView, ranges: readonly T[]) => Range<Decoration>[];
    shouldRebuild?: (update: ViewUpdate) => boolean;
    mapDecorations?: (
      decorations: DecorationSet,
      update: ViewUpdate,
    ) => DecorationSet;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
    spanName?: string;
  },
): Extension {
  const mapDecorations = options.mapDecorations
    ?? ((decorations: DecorationSet, update: ViewUpdate) => (
      update.docChanged ? decorations.map(update.changes) : decorations
    ));

  class IncrementalDecorationsViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = measurePluginBranch(options.spanName, "create", () => buildFn(view));
    }

    update(update: ViewUpdate): void {
      const programmaticDocRewrite = (update.transactions ?? []).some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation) === true
      );
      if (programmaticDocRewrite) {
        this.decorations = measurePluginBranch(
          options.spanName,
          "rebuild",
          () => buildFn(update.view),
        );
        return;
      }

      if (options.shouldRebuild?.(update)) {
        this.decorations = measurePluginBranch(
          options.spanName,
          "rebuild",
          () => buildFn(update.view),
        );
        return;
      }

      const dirtyRanges = options.incrementalRanges(update);
      if (dirtyRanges === null) {
        this.decorations = measurePluginBranch(
          options.spanName,
          "rebuild",
          () => buildFn(update.view),
        );
        return;
      }

      if (dirtyRanges.length === 0) {
        this.decorations = measurePluginBranch(
          options.spanName,
          "map",
          () => mapDecorations(this.decorations, update),
        );
        return;
      }

      this.decorations = measurePluginBranch(
        options.spanName,
        update.docChanged ? "incrementalDoc" : "incrementalContext",
        () => {
          let nextDecorations = mapDecorations(this.decorations, update);
          nextDecorations = filterDecorationSetInRanges(
            nextDecorations,
            dirtyRanges,
            (from, to) => !rangeIntersectsRanges(from, to, dirtyRanges),
          );
          const items = options.collectRanges(update.view, dirtyRanges);
          if (items.length > 0) {
            nextDecorations = nextDecorations.update({
              add: items,
              sort: true,
            });
          }
          return nextDecorations;
        },
      );
    }
  }

  return ViewPlugin.fromClass(IncrementalDecorationsViewPlugin, {
    ...options.pluginSpec,
    decorations: (value) => value.decorations,
  });
}

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
    spanName?: string;
  },
): Extension {
  class CursorSensitivePlugin implements PluginValue {
    decorations!: DecorationSet;
    private coveredRanges!: VisibleRange[];

    constructor(view: EditorView) {
      const items = measurePluginBranch(options?.spanName, "create", () =>
        collectFn(view, view.visibleRanges, NO_SKIP)
      );
      this.decorations = buildDecorations(items);
      this.coveredRanges = snapshotRanges(view.visibleRanges);
    }

    private rebuild(view: EditorView): void {
      const items = measurePluginBranch(options?.spanName, "rebuild", () =>
        collectFn(view, view.visibleRanges, NO_SKIP)
      );
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
      measurePluginBranch(options?.spanName, "viewport", () => {
        this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, []);
      });
    }

    private incrementalDocUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      measurePluginBranch(options?.spanName, "incrementalDoc", () => {
        const mappedCoveredRanges = mapVisibleRanges(this.coveredRanges, update.changes);
        this.updateVisibleRanges(
          update.view,
          this.decorations.map(update.changes),
          mappedCoveredRanges,
          dirtyRanges,
        );
      });
    }

    private incrementalContextUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      measurePluginBranch(options?.spanName, "incrementalContext", () => {
        this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, dirtyRanges);
      });
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

        this.incrementalDocUpdate(update, dirtyRanges as readonly VisibleRange[]);
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

export type SemanticSensitiveDirtyRangeFn<
  T extends DecorationRangeBounds,
> = (
  update: ViewUpdate,
  context: SemanticSensitiveUpdateContext,
) => readonly T[] | null;

export function createSemanticSensitiveViewPlugin<
  T extends DecorationRangeBounds = DecorationRangeBounds,
>(
  buildFn: (view: EditorView) => DecorationSet,
  options: {
    collectRanges: (view: EditorView, dirtyRanges: readonly T[]) => Range<Decoration>[];
    semanticChanged: (beforeState: EditorState, afterState: EditorState) => boolean;
    dirtyRangeFn: SemanticSensitiveDirtyRangeFn<T>;
    contextChanged?: (update: ViewUpdate) => boolean;
    contextUpdateMode?: "rebuild" | "dirty-ranges";
    shouldRebuild?: (
      update: ViewUpdate,
      context: SemanticSensitiveUpdateContext,
    ) => boolean;
    mapDecorations?: (
      decorations: DecorationSet,
      update: ViewUpdate,
    ) => DecorationSet;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
    spanName?: string;
  },
): Extension {
  const mapDecorations = options.mapDecorations
    ?? ((decorations: DecorationSet, update: ViewUpdate) => (
      update.docChanged ? decorations.map(update.changes) : decorations
    ));

  class SemanticSensitiveViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = measurePluginBranch(options.spanName, "create", () => buildFn(view));
    }

    private rebuild(view: EditorView): void {
      this.decorations = measurePluginBranch(options.spanName, "rebuild", () => buildFn(view));
    }

    private updateDirtyRanges(
      update: ViewUpdate,
      dirtyRanges: readonly T[],
    ): void {
      this.decorations = measurePluginBranch(options.spanName, "dirty", () => {
        let nextDecorations = mapDecorations(this.decorations, update);
        if (dirtyRanges.length > 0) {
          nextDecorations = filterDecorationSetInRanges(
            nextDecorations,
            dirtyRanges,
            (from, to) => !rangeIntersectsRanges(from, to, dirtyRanges),
          );
          const items = options.collectRanges(update.view, dirtyRanges);
          if (items.length > 0) {
            nextDecorations = nextDecorations.update({
              add: items,
              sort: true,
            });
          }
        }

        return nextDecorations;
      });
    }

    update(update: ViewUpdate): void {
      const programmaticDocRewrite = (update.transactions ?? []).some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation) === true
      );
      if (programmaticDocRewrite) {
        this.rebuild(update.view);
        return;
      }

      const plan = planSemanticSensitiveUpdate(update, {
        docChanged: (current) => current.docChanged,
        semanticChanged: (current) => options.semanticChanged(
          current.startState,
          current.state,
        ),
        contextChanged: options.contextChanged,
        shouldRebuild: options.shouldRebuild,
        dirtyRanges: options.dirtyRangeFn,
        contextUpdateMode: options.contextUpdateMode,
      });

      switch (plan.kind) {
        case "keep":
          return;
        case "map":
          this.decorations = measurePluginBranch(
            options.spanName,
            "map",
            () => mapDecorations(this.decorations, update),
          );
          return;
        case "rebuild":
          this.rebuild(update.view);
          return;
        case "dirty":
          this.updateDirtyRanges(update, plan.dirtyRanges);
          return;
      }
    }
  }

  return ViewPlugin.fromClass(SemanticSensitiveViewPlugin, {
    ...options.pluginSpec,
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
    spanName?: string;
  },
): Extension {
  const shouldUpdate = options?.shouldUpdate ?? defaultShouldUpdate;

  class SimpleViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = measurePluginBranch(options?.spanName, "create", () => buildFn(view));
    }

    update(update: ViewUpdate): void {
      if (shouldUpdate(update)) {
        this.decorations = measurePluginBranch(
          options?.spanName,
          "rebuild",
          () => buildFn(update.view),
        );
      }
    }
  }

  return ViewPlugin.fromClass(SimpleViewPlugin, {
    ...options?.pluginSpec,
    decorations: (value) => value.decorations,
  });
}
