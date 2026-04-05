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
import { type EditorSelection, type EditorState, type Extension, type Range } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import {
  classifyReference,
  type ResolvedCrossref,
} from "../index/crossref-resolver";
import {
  type BibStore,
  bibDataEffect,
  bibDataField,
  CitationWidget,
} from "../citations/citation-render";
import {
  type CslProcessor,
  collectCitationMatches,
  getCitationRegistrationKey,
  registerCitationsWithProcessor,
} from "../citations/csl-processor";
import {
  CrossrefWidget,
  ClusteredCrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
  type ClusteredCrossrefPart,
  type MixedClusterPart,
} from "./crossref-render";
import { buildDecorations, cursorInRange, pushWidgetDecoration, createSimpleViewPlugin } from "./render-utils";
import { blockCounterField, pluginRegistryField } from "../plugins";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import type { DocumentAnalysis, ReferenceSemantics } from "../semantics/document";

function serializeKeyPart(value: string | undefined): string {
  return value ?? "";
}

function getEquationNumberingKey(analysis: DocumentAnalysis): string {
  return analysis.equations
    .map((equation) => `${equation.id}\0${equation.number}`)
    .join("\u0001");
}

function getBlockNumberingKey(state: EditorState): string {
  const counters = state.field(blockCounterField, false);
  if (!counters) return "";

  return counters.blocks
    .map((block) => `${block.type}\0${serializeKeyPart(block.id)}\0${block.number}`)
    .join("\u0001");
}

function referenceSliceChanged(
  before: DocumentAnalysis,
  after: DocumentAnalysis,
): boolean {
  return (
    before.references !== after.references ||
    before.referenceByFrom !== after.referenceByFrom ||
    getDocumentAnalysisSliceRevision(before, "references")
      !== getDocumentAnalysisSliceRevision(after, "references")
  );
}

function crossrefNumberingChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  const beforeAnalysis = beforeState.field(documentAnalysisField);
  const afterAnalysis = afterState.field(documentAnalysisField);
  const beforeCounters = beforeState.field(blockCounterField, false);
  const afterCounters = afterState.field(blockCounterField, false);
  const equationSliceChanged =
    beforeAnalysis.equations !== afterAnalysis.equations ||
    beforeAnalysis.equationById !== afterAnalysis.equationById ||
    getDocumentAnalysisSliceRevision(beforeAnalysis, "equations")
      !== getDocumentAnalysisSliceRevision(afterAnalysis, "equations");

  if (
    equationSliceChanged &&
    getEquationNumberingKey(beforeAnalysis) !== getEquationNumberingKey(afterAnalysis)
  ) {
    return true;
  }

  return (
    beforeCounters !== afterCounters &&
    getBlockNumberingKey(beforeState) !== getBlockNumberingKey(afterState)
  );
}

function bibliographyInputsChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  const beforeBib = beforeState.field(bibDataField);
  const afterBib = afterState.field(bibDataField);

  return (
    beforeBib.store !== afterBib.store ||
    beforeBib.cslProcessor !== afterBib.cslProcessor ||
    beforeBib.processorRevision !== afterBib.processorRevision
  );
}

function blockLabelConfigChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  return (
    beforeState.field(pluginRegistryField, false)
      !== afterState.field(pluginRegistryField, false)
  );
}

export function referenceRenderDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  const beforeAnalysis = beforeState.field(documentAnalysisField);
  const afterAnalysis = afterState.field(documentAnalysisField);

  return (
    bibliographyInputsChanged(beforeState, afterState) ||
    blockLabelConfigChanged(beforeState, afterState) ||
    referenceSliceChanged(beforeAnalysis, afterAnalysis) ||
    crossrefNumberingChanged(beforeState, afterState)
  );
}

function findActiveReference(
  references: readonly ReferenceSemantics[],
  selection: EditorSelection,
): ReferenceSemantics | undefined {
  const { from, to } = selection.main;
  let lo = 0;
  let hi = references.length - 1;
  let candidate: ReferenceSemantics | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const ref = references[mid];
    if (ref.from <= from) {
      candidate = ref;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return candidate && to <= candidate.to ? candidate : undefined;
}

/**
 * Ensure citations from the current document analysis are registered with the
 * CSL processor. Caches per (analysis, store, revision) triple to avoid
 * redundant re-registration.
 *
 * Exported so the bibliography plugin can call it before requesting formatted
 * bibliography entries — otherwise `bibliography()` returns [] when it runs
 * before the reference render plugin has registered citations. (#466)
 */
export function ensureCitationsRegistered(
  analysis: DocumentAnalysis,
  store: BibStore,
  processor: CslProcessor,
): void {
  const matches = collectCitationMatches(analysis.references, store);
  const registrationKey = getCitationRegistrationKey(matches);
  // Shared processors can be re-registered by other surfaces (read mode,
  // hover previews, HTML export), so the authoritative cache lives on the
  // processor instead of this view-layer helper.
  if (processor.citationRegistrationKey === registrationKey) {
    return;
  }

  registerCitationsWithProcessor(matches, processor);
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
 * - Cursor inside → source-mark
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
): ReferenceRenderItem[] {
  const analysis = view.state.field(documentAnalysisField);
  const equationLabels = analysis.equationById;
  const allRefs = analysis.references;
  const items: ReferenceRenderItem[] = [];

  for (const ref of allRefs) {
    if (cursorInRange(view, ref.from, ref.to)) {
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

  for (const item of plan) {
    switch (item.kind) {
      case "source-mark":
        ranges.push(sourceMarkDecoration.range(item.from, item.to));
        break;
      case "citation":
        pushWidgetDecoration(ranges, new CitationWidget(item.rendered, item.ids, item.narrative), item.from, item.to);
        break;
      case "mixed-cluster":
        pushWidgetDecoration(ranges, new MixedClusterWidget(item.parts, item.raw), item.from, item.to);
        break;
      case "crossref":
        pushWidgetDecoration(ranges, new CrossrefWidget(item.resolved, item.raw), item.from, item.to);
        break;
      case "clustered-crossref":
        pushWidgetDecoration(ranges, new ClusteredCrossrefWidget(item.parts, item.raw), item.from, item.to);
        break;
      case "unresolved":
        pushWidgetDecoration(ranges, new UnresolvedRefWidget(item.raw), item.from, item.to);
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
): Range<Decoration>[] {
  const processor = cslProcessor ?? view.state.field(bibDataField).cslProcessor;
  const analysis = view.state.field(documentAnalysisField);

  // Numeric CSL registration is global to document order. Cache it at the
  // (analysis, bibliography-store) boundary so ordinary navigation does not
  // reset and replay every citation cluster.
  ensureCitationsRegistered(analysis, store, processor);

  return emitReferenceDecorations(planReferenceRendering(view, store, processor));
}

/** Build reference decorations from the view state. */
function buildReferenceDecorations(view: EditorView): DecorationSet {
  const { store, cslProcessor } = view.state.field(bibDataField);
  return buildDecorations(collectReferenceRanges(view, store, cslProcessor));
}

/** Custom update predicate: standard conditions + bibDataEffect. */
function referenceShouldUpdate(update: ViewUpdate): boolean {
  if (
    update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(bibDataEffect)),
    ) ||
    referenceRenderDependenciesChanged(update.startState, update.state)
  ) {
    return true;
  }

  if (!update.selectionSet && !update.focusChanged) return false;

  const oldFocus = update.focusChanged ? !update.view.hasFocus : update.view.hasFocus;
  const before = oldFocus
    ? findActiveReference(
        update.startState.field(documentAnalysisField).references,
        update.startState.selection,
      )
    : undefined;
  const after = update.view.hasFocus
    ? findActiveReference(
        update.state.field(documentAnalysisField).references,
        update.state.selection,
      )
    : undefined;

  return (
    before?.from !== after?.from ||
    before?.to !== after?.to
  );
}

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
export const referenceRenderPlugin: Extension = createSimpleViewPlugin(
  buildReferenceDecorations,
  { shouldUpdate: referenceShouldUpdate },
);
