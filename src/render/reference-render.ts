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
import { type Extension, type Range } from "@codemirror/state";
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
import { buildDecorations, cursorInRange, pushWidgetDecoration, defaultShouldUpdate, createSimpleViewPlugin } from "./render-utils";
import { documentAnalysisField } from "../semantics/codemirror-source";

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
  const doc = view.state.doc.toString();
  const analysis = view.state.field(documentAnalysisField);
  const equationLabels = analysis.equationById;
  const allRefs = analysis.references;

  // Register citation clusters with CSL processor (needed for numeric styles).
  // For mixed clusters (crossref + citation), only register the bib ids so
  // numeric styles assign numbers correctly when cite() is called per-id.
  registerCitationsWithProcessor(
    allRefs
      .filter((ref) => ref.ids.some((id) => store.has(id)))
      .map((ref) => {
        const bibIds = ref.ids.filter((id) => store.has(id));
        const bibLocators = ref.locators.filter((_, i) => store.has(ref.ids[i]));
        return { ids: bibIds, locators: bibLocators };
      }),
    processor,
  );

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
        const raw = doc.slice(ref.from, ref.to);
        const parts: MixedClusterPart[] = ref.ids.map((id, index) => {
          if (store.has(id)) {
            const rendered = processor.cite([id], ref.locators ? [ref.locators[index]] : undefined);
            // Strip outer parens from single-item cite (e.g. "(Smith, 2020)" -> "Smith, 2020")
            const stripped = rendered.startsWith("(") && rendered.endsWith(")")
              ? rendered.slice(1, -1)
              : rendered;
            return { kind: "citation" as const, text: stripped };
          }
          const resolved = resolveCrossref(view.state, id, equationLabels);
          const label = resolved.kind === "block" || resolved.kind === "equation"
            ? resolved.label
            : id;
          return { kind: "crossref" as const, text: label };
        });
        pushWidgetDecoration(items, new MixedClusterWidget(parts, raw), ref.from, ref.to);
      } else if (ref.ids.length === 1) {
        const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);
        const raw = doc.slice(ref.from, ref.to);
        const widget = resolved.kind === "block" || resolved.kind === "equation"
          ? new CrossrefWidget(resolved, raw)
          : new UnresolvedRefWidget(raw);
        pushWidgetDecoration(items, widget, ref.from, ref.to);
      } else {
        // Multi-id bracketed reference where no id is a citation — resolve each as crossref
        const resolvedItems = ref.ids.map((id) => resolveCrossref(view.state, id, equationLabels));
        const raw = doc.slice(ref.from, ref.to);
        const allResolved = resolvedItems.every((r) => r.kind === "block" || r.kind === "equation");
        const widget = allResolved
          ? new ClusteredCrossrefWidget(resolvedItems, raw)
          : new UnresolvedRefWidget(raw);
        pushWidgetDecoration(items, widget, ref.from, ref.to);
      }
    } else {
      // Narrative @id — crossref takes priority over citation
      const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);
      if (resolved.kind === "block" || resolved.kind === "equation") {
        const raw = doc.slice(ref.from, ref.to);
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
  return (
    defaultShouldUpdate(update) ||
    update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(bibDataEffect)),
    )
  );
}

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
export const referenceRenderPlugin: Extension = createSimpleViewPlugin(
  buildReferenceDecorations,
  { shouldUpdate: referenceShouldUpdate },
);
