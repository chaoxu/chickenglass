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
import { type EditorSelection, type Extension, type Range } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { resolveCrossref } from "../index/crossref-resolver";
import {
  type BibStore,
  bibDataEffect,
  bibDataField,
  CitationWidget,
} from "../citations/citation-render";
import { type CslProcessor, registerCitationsWithProcessor } from "../citations/csl-processor";
import { CrossrefWidget, ClusteredCrossrefWidget, MixedClusterWidget, UnresolvedRefWidget, type MixedClusterPart } from "./crossref-render";
import { buildDecorations, cursorInRange, pushWidgetDecoration, createSimpleViewPlugin } from "./render-utils";
import { documentAnalysisField } from "../semantics/codemirror-source";
import type { DocumentAnalysis, ReferenceSemantics } from "../semantics/document";

interface ReferenceRegistrationCacheEntry {
  readonly analysis: DocumentAnalysis;
  readonly store: BibStore;
  readonly processorRevision: number;
}

const referenceRegistrationCache = new WeakMap<CslProcessor, ReferenceRegistrationCacheEntry>();

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
  const cached = referenceRegistrationCache.get(processor);
  if (
    cached?.analysis === analysis &&
    cached.store === store &&
    cached.processorRevision === processor.revision
  ) {
    return;
  }

  registerCitationsWithProcessor(
    analysis.references
      .filter((ref) => ref.ids.some((id) => store.has(id)))
      .map((ref) => {
        const bibIds = ref.ids.filter((id) => store.has(id));
        const bibLocators = ref.locators.filter((_, i) => store.has(ref.ids[i]));
        return { ids: bibIds, locators: bibLocators };
      }),
    processor,
  );

  referenceRegistrationCache.set(processor, {
    analysis,
    store,
    processorRevision: processor.revision,
  });
}

/**
 * Collect decoration ranges for all references (crossrefs + citations).
 *
 * Routing per match:
 * - Bracketed all-bib cluster → CitationWidget (full CSL formatting)
 * - Bracketed mixed cluster (some bib, some crossref) → MixedClusterWidget
 * - Bracketed single id, block/equation → CrossrefWidget
 * - Bracketed single id, unknown → UnresolvedRefWidget
 * - Narrative, block/equation → CrossrefWidget
 * - Narrative, bib id → CitationWidget (narrative style)
 */
export function collectReferenceRanges(
  view: EditorView,
  store: BibStore,
  cslProcessor?: CslProcessor,
): Range<Decoration>[] {
  const processor = cslProcessor ?? view.state.field(bibDataField).cslProcessor;
  const analysis = view.state.field(documentAnalysisField);
  const equationLabels = analysis.equationById;
  const allRefs = analysis.references;

  // Numeric CSL registration is global to document order. Cache it at the
  // (analysis, bibliography-store) boundary so ordinary navigation does not
  // reset and replay every citation cluster.
  ensureCitationsRegistered(analysis, store, processor);

  const sourceMarkDecoration = Decoration.mark({ class: CSS.referenceSource });
  const items: Range<Decoration>[] = [];

  for (const ref of allRefs) {
    if (cursorInRange(view, ref.from, ref.to)) {
      // Cursor inside reference — show raw token with monospace source styling
      items.push(sourceMarkDecoration.range(ref.from, ref.to));
      continue;
    }

    if (ref.bracketed) {
      const hasCitation = ref.ids.some((id) => store.has(id));

      const allCitations = hasCitation && ref.ids.every((id) => store.has(id));

      if (allCitations) {
        // Pure citation cluster — send all ids to CSL
        const rendered = processor.cite([...ref.ids], [...ref.locators]);
        pushWidgetDecoration(items, new CitationWidget(rendered, ref.ids), ref.from, ref.to);
      } else if (hasCitation) {
        // Mixed cluster — split crossref ids from citation ids
        const raw = view.state.sliceDoc(ref.from, ref.to);
        const parts: MixedClusterPart[] = ref.ids.map((id, index) => {
          if (store.has(id)) {
            const rendered = processor.cite([id], ref.locators ? [ref.locators[index]] : undefined);
            // Strip outer parens from single-item cite (e.g. "(Smith, 2020)" -> "Smith, 2020")
            const stripped = rendered.startsWith("(") && rendered.endsWith(")")
              ? rendered.slice(1, -1)
              : rendered;
            return { kind: "citation" as const, id, text: stripped };
          }
          const resolved = resolveCrossref(view.state, id, equationLabels);
          const label = resolved.kind === "block" || resolved.kind === "equation"
            ? resolved.label
            : id;
          return { kind: "crossref" as const, id, text: label };
        });
        pushWidgetDecoration(items, new MixedClusterWidget(parts, raw), ref.from, ref.to);
      } else if (ref.ids.length === 1) {
        const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);
        const raw = view.state.sliceDoc(ref.from, ref.to);
        const widget = resolved.kind === "block" || resolved.kind === "equation"
          ? new CrossrefWidget(resolved, raw)
          : new UnresolvedRefWidget(raw);
        pushWidgetDecoration(items, widget, ref.from, ref.to);
      } else {
        // Multi-id bracketed reference where no id is a citation — resolve each as crossref
        const resolvedItems = ref.ids.map((id) => resolveCrossref(view.state, id, equationLabels));
        const raw = view.state.sliceDoc(ref.from, ref.to);
        const allResolved = resolvedItems.every((r) => r.kind === "block" || r.kind === "equation");
        const widget = allResolved
          ? new ClusteredCrossrefWidget(resolvedItems, ref.ids, raw)
          : new UnresolvedRefWidget(raw);
        pushWidgetDecoration(items, widget, ref.from, ref.to);
      }
    } else {
      // Narrative @id — crossref takes priority over citation
      const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);
      if (resolved.kind === "block" || resolved.kind === "equation") {
        const raw = view.state.sliceDoc(ref.from, ref.to);
        pushWidgetDecoration(items, new CrossrefWidget(resolved, raw), ref.from, ref.to);
      } else {
        const entry = store.get(ref.ids[0]);
        if (!entry) continue;
        const rendered = processor.citeNarrative(ref.ids[0]);
        pushWidgetDecoration(items, new CitationWidget(rendered, ref.ids, true), ref.from, ref.to);
      }
    }
  }

  return items;
}

/** Build reference decorations from the view state. */
function buildReferenceDecorations(view: EditorView): DecorationSet {
  const { store, cslProcessor } = view.state.field(bibDataField);
  return buildDecorations(collectReferenceRanges(view, store, cslProcessor));
}

/** Custom update predicate: standard conditions + bibDataEffect. */
function referenceShouldUpdate(update: ViewUpdate): boolean {
  if (
    update.docChanged ||
    update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(bibDataEffect)),
    ) ||
    update.state.field(documentAnalysisField) !== update.startState.field(documentAnalysisField)
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
