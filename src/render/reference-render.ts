/**
 * Unified CM6 ViewPlugin for rendering all [@id] and @id references.
 *
 * Replaces the separate crossref-render and citation-render ViewPlugins
 * with a single tree walk that routes each reference to the appropriate
 * widget based on whether the id resolves as a block/equation crossref
 * or a bibliography citation.
 *
 * Widget classes (CrossrefWidget, CitationWidget, etc.) remain in their
 * original modules — this plugin only handles discovery and routing.
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type ChangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import {
  classifyReference,
  type ResolvedCrossref,
} from "../index/crossref-resolver";
import { forEachOverlappingOrderedRange } from "../lib/range-helpers";
import { ensureCitationsRegistered } from "../citations/citation-registration";
import {
  type BibStore,
  CitationWidget,
} from "../citations/citation-render";
import {
  type CslProcessor,
} from "../citations/csl-processor";
import {
  CrossrefWidget,
  ClusteredCrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
  type ClusteredCrossrefPart,
  type MixedClusterPart,
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

// ── Helper functions ──────────────────────────────────────────────

/**
 * Strip outer parentheses from a string if they exist.
 * Used to clean citation formatting for display (e.g., "(Karger, 2000)" → "Karger, 2000").
 */
function stripOuterParens(text: string): string {
  return text.startsWith("(") && text.endsWith(")")
    ? text.slice(1, -1)
    : text;
}

// ── Render-plan types ──────────────────────────────────────────────

/** A planned reference rendering before widget emission. */
export type ReferenceRenderItem =
  | { readonly kind: "source-mark"; readonly from: number; readonly to: number }
  | { readonly kind: "citation"; readonly from: number; readonly to: number; readonly rendered: string; readonly ids: readonly string[]; readonly narrative: boolean }
  | { readonly kind: "mixed-cluster"; readonly from: number; readonly to: number; readonly parts: readonly MixedClusterPart[]; readonly raw: string }
  | { readonly kind: "crossref"; readonly from: number; readonly to: number; readonly resolved: ResolvedCrossref; readonly raw: string }
  | { readonly kind: "clustered-crossref"; readonly from: number; readonly to: number; readonly parts: readonly ClusteredCrossrefPart[]; readonly raw: string }
  | { readonly kind: "unresolved"; readonly from: number; readonly to: number; readonly raw: string };

// ── Plan: pure routing without widget creation ─────────────────────

/**
 * Classify each reference into a render-plan item.
 *
 * Routing per reference:
 * - Focused cursor/selection inside → source-mark
 * - Bracketed all-bib cluster → citation (parenthetical)
 * - Bracketed mixed cluster (some bib, some crossref) → mixed-cluster
 * - Bracketed single id, block/equation → crossref
 * - Bracketed multi id, at least one block/equation → clustered-crossref
 *   with unresolved items degraded in place
 * - Bracketed ids, none resolve to block/equation/citation → unresolved
 * - Narrative, block/equation → crossref
 * - Narrative, bib id → citation (narrative)
 *
 * Citations must be registered with the processor before calling this
 * function (see {@link ensureCitationsRegistered}).
 */
export function planReferenceRendering(
  view: EditorView,
  store: BibStore,
  processor: CslProcessor,
  references = getReferenceRenderAnalysis(view.state).references,
): ReferenceRenderItem[] {
  const analysis = getReferenceRenderAnalysis(view.state);
  const equationLabels = analysis.equationById;
  const items: ReferenceRenderItem[] = [];
  const activeRef = getRevealedReferenceTarget(view.state, view.hasFocus);

  for (const ref of references) {
    if (activeRef && activeRef.from === ref.from && activeRef.to === ref.to) {
      items.push({ kind: "source-mark", from: ref.from, to: ref.to });
      continue;
    }

    const classifications = ref.ids.map((id) =>
      classifyReference(view.state, id, {
        bibliography: store,
        equationLabels,
        preferCitation: ref.bracketed,
      }),
    );

    if (ref.bracketed) {
      const hasCitation = classifications.some((classification) => classification.kind === "citation");
      const allCitations = hasCitation && classifications.every((classification) => classification.kind === "citation");

      if (allCitations) {
        const rendered = processor.cite([...ref.ids], [...ref.locators]);
        items.push({ kind: "citation", from: ref.from, to: ref.to, rendered, ids: ref.ids, narrative: false });
      } else if (hasCitation) {
        const raw = view.state.sliceDoc(ref.from, ref.to);
        const parts: MixedClusterPart[] = ref.ids.map((id, index) => {
          const classification = classifications[index];
          if (classification.kind === "citation") {
            const rendered = processor.cite([id], ref.locators ? [ref.locators[index]] : undefined);
            const stripped = stripOuterParens(rendered);
            return { kind: "citation" as const, id, text: stripped };
          }
          const label = classification.kind === "crossref"
            ? classification.resolved.label
            : id;
          return { kind: "crossref" as const, id, text: label };
        });
        items.push({ kind: "mixed-cluster", from: ref.from, to: ref.to, parts, raw });
      } else if (ref.ids.length === 1) {
        const resolved = classifications[0];
        const raw = view.state.sliceDoc(ref.from, ref.to);
        if (resolved.kind === "crossref") {
          items.push({ kind: "crossref", from: ref.from, to: ref.to, resolved: resolved.resolved, raw });
        } else {
          items.push({ kind: "unresolved", from: ref.from, to: ref.to, raw });
        }
      } else {
        const raw = view.state.sliceDoc(ref.from, ref.to);
        const parts = classifications.map((resolved, index) => {
          if (resolved.kind === "crossref") {
            return {
              id: ref.ids[index],
              text: resolved.resolved.label,
            };
          }
          return {
            id: ref.ids[index],
            text: ref.ids[index],
            unresolved: true,
          };
        });
        if (parts.some((part) => !part.unresolved)) {
          items.push({ kind: "clustered-crossref", from: ref.from, to: ref.to, parts, raw });
        } else {
          items.push({ kind: "unresolved", from: ref.from, to: ref.to, raw });
        }
      }
    } else {
      const resolved = classifications[0];
      if (resolved.kind === "crossref") {
        const raw = view.state.sliceDoc(ref.from, ref.to);
        items.push({ kind: "crossref", from: ref.from, to: ref.to, resolved: resolved.resolved, raw });
      } else if (resolved.kind === "citation") {
        const rendered = processor.citeNarrative(ref.ids[0]);
        items.push({ kind: "citation", from: ref.from, to: ref.to, rendered, ids: ref.ids, narrative: true });
      }
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
  ensureCitationsRegistered(analysis, store, processor);

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
  },
);

export { computeReferenceDirtyRanges as _computeReferenceDirtyRangesForTest };
