/**
 * Unified CM6 ViewPlugin for rendering all [@id] and @id references.
 *
 * Replaces the separate crossref-render and citation-render ViewPlugins
 * with a single tree walk that routes each reference to the appropriate
 * widget based on whether the id resolves as a block/heading/equation crossref
 * or a bibliography citation.
 *
 * Widget classes remain render-owned; this plugin only handles discovery and
 * routing.
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type ChangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import type { ResolvedCrossref } from "../references/presentation";
import { forEachOverlappingOrderedRange } from "../lib/range-helpers";
import {
  type CslProcessor,
} from "../citations/csl-processor";
import type { BibStore } from "../state/bib-data";
import { CitationWidget } from "./citation-widget";
import {
  CrossrefWidget,
  ClusteredCrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import { buildDecorations, pushWidgetDecoration } from "./decoration-core";
import {
  type ReferenceSemantics,
} from "../semantics/document";
import {
  type DirtyRange,
  dirtyRangesFromChanges,
  expandChangeRangeToLines,
  mergeDirtyRanges,
} from "./incremental-dirty-ranges";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import { isDebugRenderFlagEnabled } from "./debug-render-flags";
import { createSemanticSensitiveViewPlugin } from "./view-plugin-factories";
import {
  createEditorReferencePresentationController,
  ensureEditorReferencePresentationCitationsRegistered,
  type ReferencePresentationClusteredCrossrefPart,
  type ReferencePresentationMixedPart,
  type ReferencePresentationRoute,
} from "../references/presentation";
import {
  getReferenceRenderAnalysis,
  getReferenceRenderState,
  referenceRenderRebuildDependenciesChanged,
  referenceRenderSliceChanged,
} from "../state/reference-render-state";

export {
  getReferenceRenderDependencySignature,
  referenceRenderDependenciesChanged,
} from "../state/reference-render-state";

function getRevealedReferenceTarget(
  state: EditorState,
  focused: boolean,
): Pick<ReferenceSemantics, "from" | "to"> | null {
  const analysis = getReferenceRenderAnalysis(state);
  return findFocusedInlineRevealTarget(
    state.selection.main,
    analysis.references,
    focused,
  );
}

// ── Render-plan types ──────────────────────────────────────────────

/** A planned reference rendering before widget emission. */
export type ReferenceRenderItem =
  | { readonly kind: "source-mark"; readonly from: number; readonly to: number }
  | { readonly kind: "citation"; readonly from: number; readonly to: number; readonly rendered: string; readonly ids: readonly string[]; readonly narrative: boolean }
  | { readonly kind: "mixed-cluster"; readonly from: number; readonly to: number; readonly parts: readonly ReferencePresentationMixedPart[]; readonly raw: string }
  | { readonly kind: "crossref"; readonly from: number; readonly to: number; readonly resolved: ResolvedCrossref; readonly raw: string }
  | { readonly kind: "clustered-crossref"; readonly from: number; readonly to: number; readonly parts: readonly ReferencePresentationClusteredCrossrefPart[]; readonly raw: string }
  | { readonly kind: "unresolved"; readonly from: number; readonly to: number; readonly raw: string };

function toRenderItem(
  route: ReferencePresentationRoute,
  from: number,
  to: number,
): ReferenceRenderItem {
  switch (route.kind) {
    case "citation":
      return { ...route, from, to };
    case "mixed-cluster":
      return { ...route, from, to };
    case "crossref":
      return { ...route, from, to };
    case "clustered-crossref":
      return { ...route, from, to };
    case "unresolved":
      return { ...route, from, to };
  }
}

// ── Plan: pure routing without widget creation ─────────────────────

/**
 * Classify each reference into a render-plan item.
 *
 * Routing per reference:
 * - Focused cursor/selection inside → source-mark
 * - Bracketed all-bib cluster → citation (parenthetical)
 * - Bracketed mixed cluster (some bib, some crossref) → mixed-cluster
 * - Bracketed single id, block/heading/equation → crossref
 * - Bracketed multi id, at least one block/heading/equation → clustered-crossref
 *   with unresolved items degraded in place
 * - Bracketed ids, none resolve to block/equation/citation → unresolved
 * - Narrative, block/heading/equation → crossref
 * - Narrative, bib id → citation (narrative)
 *
 * Citations must be registered with the processor before calling this
 * function (see {@link ensureEditorReferencePresentationCitationsRegistered}).
 */
export function planReferenceRendering(
  view: EditorView,
  store: BibStore,
  processor: CslProcessor,
  references = getReferenceRenderAnalysis(view.state).references,
): ReferenceRenderItem[] {
  const controller = createEditorReferencePresentationController(view.state, {
    store,
    cslProcessor: processor,
  });
  const items: ReferenceRenderItem[] = [];
  const activeRef = getRevealedReferenceTarget(view.state, view.hasFocus);

  for (const ref of references) {
    if (activeRef && activeRef.from === ref.from && activeRef.to === ref.to) {
      items.push({ kind: "source-mark", from: ref.from, to: ref.to });
      continue;
    }

    const route = controller.planReference({
      bracketed: ref.bracketed,
      ids: ref.ids,
      locators: ref.locators,
      raw: view.state.sliceDoc(ref.from, ref.to),
    });
    if (route) {
      items.push(toRenderItem(route, ref.from, ref.to));
    }
  }

  return items;
}

// ── Emit: map plan items to CM6 decorations ────────────────────────

function emitReferenceDecorations(plan: readonly ReferenceRenderItem[]): Range<Decoration>[] {
  const sourceMarkDecoration = Decoration.mark({ class: CSS.referenceSource });
  const ranges: Range<Decoration>[] = [];
  const disableReferenceWidgets = isDebugRenderFlagEnabled("disableReferenceWidgets");

  for (const item of plan) {
    switch (item.kind) {
      case "source-mark":
        ranges.push(sourceMarkDecoration.range(item.from, item.to));
        break;
      case "citation":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(
            ranges,
            new CitationWidget(item.rendered, item.ids, item.narrative),
            item.from,
            item.to,
          );
        }
        break;
      case "mixed-cluster":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(ranges, new MixedClusterWidget(item.parts, item.raw), item.from, item.to);
        }
        break;
      case "crossref":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(ranges, new CrossrefWidget(item.resolved, item.raw), item.from, item.to);
        }
        break;
      case "clustered-crossref":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(
            ranges,
            new ClusteredCrossrefWidget(item.parts, item.raw),
            item.from,
            item.to,
          );
        }
        break;
      case "unresolved":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(ranges, new UnresolvedRefWidget(item.raw), item.from, item.to);
        }
        break;
    }
  }

  return ranges;
}

// ── Public entry point (composes plan + emit) ──────────────────────

/**
 * Collect decoration ranges for all references (crossrefs + citations).
 *
 * Ensures citations are registered, builds a render plan, then emits
 * CM6 decorations from that plan.
 */
export function collectReferenceRanges(
  view: EditorView,
  store: BibStore,
  cslProcessor?: CslProcessor,
  references = getReferenceRenderState(view.state).analysis.references,
): Range<Decoration>[] {
  const { analysis, bibliography } = getReferenceRenderState(view.state);
  const processor = cslProcessor ?? bibliography.cslProcessor;

  // Numeric CSL registration is global to document order. Cache it at the
  // (analysis, bibliography-store) boundary so ordinary navigation does not
  // reset and replay every citation cluster.
  ensureEditorReferencePresentationCitationsRegistered(analysis, store, processor);

  return emitReferenceDecorations(
    planReferenceRendering(
      view,
      store,
      processor,
      references,
    ),
  );
}

/** Build reference decorations from the view state. */
function buildReferenceDecorations(view: EditorView): DecorationSet {
  const { bibliography } = getReferenceRenderState(view.state);
  const { store, cslProcessor } = bibliography;
  return buildDecorations(collectReferenceRanges(view, store, cslProcessor));
}

function collectDirtyReferences(
  references: readonly ReferenceSemantics[],
  dirtyRanges: readonly DirtyRange[],
): ReferenceSemantics[] {
  if (dirtyRanges.length === 0 || references.length === 0) return [];
  const dirty: ReferenceSemantics[] = [];
  const seenFrom = new Set<number>();
  for (const range of dirtyRanges) {
    forEachOverlappingOrderedRange(references, range, (reference) => {
      if (seenFrom.has(reference.from)) return;
      seenFrom.add(reference.from);
      dirty.push(reference);
    });
  }
  return dirty;
}

function mappedDecorationsWithFreshWidgetSources(
  decorations: DecorationSet,
  changes: ChangeSet,
): DecorationSet {
  return decorations.map(changes);
}

function mergeDirtyRangesWithActiveReference(
  dirtyRanges: readonly DirtyRange[],
  ...references: readonly (Pick<ReferenceSemantics, "from" | "to"> | null)[]
): DirtyRange[] {
  const activeRanges = references.flatMap((reference) => (
    reference ? [{ from: reference.from, to: reference.to }] : []
  ));
  if (activeRanges.length === 0) return [...dirtyRanges];
  return mergeDirtyRanges([...dirtyRanges, ...activeRanges]);
}

interface ReferenceRevealChange {
  readonly beforeActive: Pick<ReferenceSemantics, "from" | "to"> | null;
  readonly afterActive: Pick<ReferenceSemantics, "from" | "to"> | null;
  readonly activeChanged: boolean;
}

function getReferenceRevealChange(update: ViewUpdate): ReferenceRevealChange {
  const endFocused = update.view.hasFocus;
  const startFocused = update.focusChanged ? !endFocused : endFocused;
  const beforeActive = getRevealedReferenceTarget(update.startState, startFocused);
  const afterActive = getRevealedReferenceTarget(update.state, endFocused);
  return {
    beforeActive,
    afterActive,
    activeChanged: inlineRevealTargetChanged(beforeActive, afterActive),
  };
}

function referenceRenderDependenciesNeedRebuild(update: ViewUpdate): boolean {
  return referenceRenderRebuildDependenciesChanged(update.startState, update.state);
}

function computeReferenceDirtyRanges(update: ViewUpdate): DirtyRange[] {
  const { beforeActive, afterActive, activeChanged } = getReferenceRevealChange(update);
  const docDirtyRanges = update.docChanged
    ? dirtyRangesFromChanges(
        update.changes,
        (from, to) => expandChangeRangeToLines(update.state.doc, from, to),
      )
    : [];
  if (
    docDirtyRanges.length > 0 &&
    !activeChanged &&
    !dirtyRangesCouldContainReferences(update, docDirtyRanges)
  ) {
    return [];
  }
  return mergeDirtyRangesWithActiveReference(
    docDirtyRanges,
    activeChanged ? beforeActive : null,
    activeChanged ? afterActive : null,
  );
}

function dirtyRangesCouldContainReferences(
  update: ViewUpdate,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  for (const range of dirtyRanges) {
    if (
      update.startState.sliceDoc(range.from, range.to).includes("@") ||
      update.state.sliceDoc(range.from, range.to).includes("@")
    ) {
      return true;
    }
  }
  return false;
}

function collectReferenceRangesForDirtySpans(
  view: EditorView,
  dirtyRanges: readonly DirtyRange[],
): Range<Decoration>[] {
  const { analysis, bibliography } = getReferenceRenderState(view.state);
  const { store, cslProcessor } = bibliography;
  const dirtyRefs = collectDirtyReferences(
    analysis.references,
    dirtyRanges,
  );
  return dirtyRefs.length > 0
    ? collectReferenceRanges(view, store, cslProcessor, dirtyRefs)
    : [];
}

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
export const referenceRenderPlugin: Extension = createSemanticSensitiveViewPlugin(
  buildReferenceDecorations,
  {
    collectRanges: collectReferenceRangesForDirtySpans,
    semanticChanged: referenceRenderSliceChanged,
    contextChanged: (update) =>
      getReferenceRevealChange(update).activeChanged,
    contextUpdateMode: "dirty-ranges",
    shouldRebuild: (update) => referenceRenderDependenciesNeedRebuild(update),
    dirtyRangeFn: (update) => computeReferenceDirtyRanges(update),
    mapDecorations: (decorations, update) =>
      mappedDecorationsWithFreshWidgetSources(decorations, update.changes),
    spanName: "cm6.referenceRender",
  },
);

export { computeReferenceDirtyRanges as _computeReferenceDirtyRangesForTest };
