import type { Transaction } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { rangeIntersectsRanges } from "./viewport-diff";

export interface DecorationRangeBounds {
  readonly from: number;
  readonly to: number;
}

export interface DecorationLifecycleContext {
  readonly docChanged: boolean;
  readonly semanticChanged: boolean;
  readonly contextChanged: boolean;
  readonly programmaticRewrite: boolean;
}

export type DecorationLifecyclePlan<T extends DecorationRangeBounds> =
  | { readonly kind: "keep" }
  | { readonly kind: "map" }
  | { readonly kind: "rebuild" }
  | { readonly kind: "dirty"; readonly dirtyRanges: readonly T[] };

export interface DecorationLifecyclePlanOptions<
  TUpdate,
  TRange extends DecorationRangeBounds,
> {
  readonly docChanged: (update: TUpdate) => boolean;
  readonly semanticChanged?: (update: TUpdate) => boolean;
  readonly contextChanged?: (update: TUpdate) => boolean;
  readonly programmaticRewrite?: (update: TUpdate) => boolean;
  readonly stableDocChangeMode?: "keep" | "map";
  readonly shouldRebuild?: (
    update: TUpdate,
    context: DecorationLifecycleContext,
  ) => boolean;
  readonly dirtyRanges?: (
    update: TUpdate,
    context: DecorationLifecycleContext,
  ) => readonly TRange[] | null;
  readonly contextUpdateMode?: "rebuild" | "dirty-ranges";
}

export function hasProgrammaticDocumentRewrite(
  update: Pick<ViewUpdate, "transactions"> | Transaction,
): boolean {
  const transactions = "transactions" in update && Array.isArray(update.transactions)
    ? update.transactions
    : [update as Transaction];
  return transactions.some((tr) =>
    typeof tr.annotation === "function" &&
    tr.annotation(programmaticDocumentChangeAnnotation) === true
  );
}

export function mapDecorationsOnDocChange(
  decorations: DecorationSet,
  update: Pick<ViewUpdate, "docChanged" | "changes">,
): DecorationSet {
  return update.docChanged ? decorations.map(update.changes) : decorations;
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

function rangesTouch(
  from: number,
  to: number,
  range: DecorationRangeBounds,
): boolean {
  if (from === to && range.from === range.to) return from === range.from;
  if (rangeIntersectsRanges(from, to, [range])) return true;
  if (from === to) return range.from < from && from < range.to;
  return range.from === range.to && from < range.from && range.from < to;
}

export function removeDecorationsInRanges<T extends DecorationRangeBounds>(
  decorations: DecorationSet,
  dirtyRanges: readonly T[],
): DecorationSet {
  if (dirtyRanges.length === 0) return decorations;
  return decorations.update({
    filter: (from, to) => !dirtyRanges.some((range) =>
      rangesTouch(from, to, range)
    ),
  });
}

export function planDecorationLifecycleUpdate<
  TUpdate,
  TRange extends DecorationRangeBounds,
>(
  update: TUpdate,
  options: DecorationLifecyclePlanOptions<TUpdate, TRange>,
): DecorationLifecyclePlan<TRange> {
  const context: DecorationLifecycleContext = {
    docChanged: options.docChanged(update),
    semanticChanged: options.semanticChanged?.(update) ?? false,
    contextChanged: options.contextChanged?.(update) ?? false,
    programmaticRewrite: options.programmaticRewrite?.(update) ?? false,
  };

  if (
    context.programmaticRewrite ||
    options.shouldRebuild?.(update, context)
  ) {
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
