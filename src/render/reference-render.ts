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
  ViewPlugin,
} from "@codemirror/view";
import { type ChangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import {
  classifyReference,
  type ResolvedCrossref,
} from "../index/crossref-resolver";
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
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import {
  getEquationNumbersCacheKey,
  type ReferenceSemantics,
} from "../semantics/document";
import { blockCounterField } from "../state/block-counter";
import { bibDataField } from "../state/bib-data";
import { pluginRegistryField } from "../state/plugin-registry";
import {
  type DirtyRange,
  dirtyRangesFromChanges,
  expandChangeRangeToLines,
  mergeDirtyRanges,
  rangeIntersectsDirtyRanges,
} from "./incremental-dirty-ranges";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { isDebugRenderFlagEnabled } from "./debug-render-flags";
import { createChangeChecker } from "../state/change-detection";

function serializeKeyPart(value: string | undefined): string {
  return value ?? "";
}

const objectIdentityIds = new WeakMap<object, number>();
let nextObjectIdentityId = 1;

function getObjectIdentityId(value: object | null | undefined): number {
  if (!value) return 0;
  const existing = objectIdentityIds.get(value);
  if (existing !== undefined) return existing;
  const next = nextObjectIdentityId++;
  objectIdentityIds.set(value, next);
  return next;
}

function getBlockNumberingKey(state: EditorState): string {
  const counters = state.field(blockCounterField, false);
  if (!counters) return "";

  return counters.blocks
    .map((block) => `${block.type}\0${serializeKeyPart(block.id)}\0${block.number}`)
    .join("\u0001");
}

const referenceSliceChanged = createChangeChecker(
  (state) => state.field(documentAnalysisField).references,
  (state) => state.field(documentAnalysisField).referenceByFrom,
  (state) => getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "references"),
);

function getEquationNumberingSnapshot(state: EditorState) {
  const analysis = state.field(documentAnalysisField);
  return {
    equations: analysis.equations,
    equationById: analysis.equationById,
    revision: getDocumentAnalysisSliceRevision(analysis, "equations"),
    key: getEquationNumbersCacheKey(analysis),
  };
}

function sameEquationNumberingSnapshot(
  before: ReturnType<typeof getEquationNumberingSnapshot>,
  after: ReturnType<typeof getEquationNumberingSnapshot>,
): boolean {
  return before.key === after.key || (
    before.equations === after.equations &&
    before.equationById === after.equationById &&
    before.revision === after.revision
  );
}

function getBlockNumberingSnapshot(state: EditorState) {
  return {
    counters: state.field(blockCounterField, false),
    key: getBlockNumberingKey(state),
  };
}

function sameBlockNumberingSnapshot(
  before: ReturnType<typeof getBlockNumberingSnapshot>,
  after: ReturnType<typeof getBlockNumberingSnapshot>,
): boolean {
  return before.key === after.key || before.counters === after.counters;
}

const crossrefNumberingChanged = createChangeChecker(
  {
    get: getEquationNumberingSnapshot,
    equals: sameEquationNumberingSnapshot,
  },
  {
    get: getBlockNumberingSnapshot,
    equals: sameBlockNumberingSnapshot,
  },
);

const bibliographyInputsChanged = createChangeChecker(
  (state) => state.field(bibDataField, false)?.store ?? null,
  (state) => state.field(bibDataField, false)?.cslProcessor ?? null,
  (state) => state.field(bibDataField, false)?.processorRevision ?? null,
);

const blockLabelConfigChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField, false),
);

export function getReferenceRenderDependencySignature(
  state: EditorState,
): string {
  const analysis = state.field(documentAnalysisField, false);
  const bibState = state.field(bibDataField, false);
  const pluginRegistry = state.field(pluginRegistryField, false);
  if (!analysis || !bibState) {
    return [
      "",
      "",
      "",
      0,
      0,
      0,
      "",
      getObjectIdentityId(pluginRegistry as object | null | undefined),
    ].join("\u0001");
  }
  const { store, cslProcessor, processorRevision } = bibState;

  return [
    getDocumentAnalysisSliceRevision(analysis, "references"),
    getEquationNumbersCacheKey(analysis),
    getBlockNumberingKey(state),
    getObjectIdentityId(store as object),
    getObjectIdentityId(cslProcessor),
    processorRevision,
    cslProcessor.citationRegistrationKey ?? "",
    getObjectIdentityId(pluginRegistry as object | null | undefined),
  ].join("\u0001");
}

export function referenceRenderDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  return (
    bibliographyInputsChanged(beforeState, afterState) ||
    blockLabelConfigChanged(beforeState, afterState) ||
    referenceSliceChanged(beforeState, afterState) ||
    crossrefNumberingChanged(beforeState, afterState)
  );
}

function getRevealedReferenceTarget(
  state: EditorState,
  focused: boolean,
): Pick<ReferenceSemantics, "from" | "to"> | null {
  return findFocusedInlineRevealTarget(
    state.selection.main,
    state.field(documentAnalysisField).references,
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
  references = view.state.field(documentAnalysisField).references,
): ReferenceRenderItem[] {
  const analysis = view.state.field(documentAnalysisField);
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
  references = view.state.field(documentAnalysisField).references,
): Range<Decoration>[] {
  const processor = cslProcessor ?? view.state.field(bibDataField).cslProcessor;
  const analysis = view.state.field(documentAnalysisField);

  // Numeric CSL registration is global to document order. Cache it at the
  // (analysis, bibliography-store) boundary so ordinary navigation does not
  // reset and replay every citation cluster.
  ensureCitationsRegistered(analysis, store, processor);

  return emitReferenceDecorations(planReferenceRendering(view, store, processor, references));
}

/** Build reference decorations from the view state. */
function buildReferenceDecorations(view: EditorView): DecorationSet {
  const { store, cslProcessor } = view.state.field(bibDataField);
  return buildDecorations(collectReferenceRanges(view, store, cslProcessor));
}

function collectDirtyReferences(
  references: readonly ReferenceSemantics[],
  dirtyRanges: readonly DirtyRange[],
): ReferenceSemantics[] {
  if (dirtyRanges.length === 0) return [];
  const dirty: ReferenceSemantics[] = [];
  for (const reference of references) {
    if (rangeIntersectsDirtyRanges(reference.from, reference.to, dirtyRanges)) {
      dirty.push(reference);
    }
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

class ReferenceRenderViewPlugin {
  decorations: DecorationSet;
  constructor(readonly view: EditorView) {
    this.decorations = buildReferenceDecorations(view);
  }

  private rebuildAll(view: EditorView): void {
    this.decorations = buildReferenceDecorations(view);
  }

  private updateDirtyRanges(
    update: ViewUpdate,
    dirtyRanges: readonly DirtyRange[],
  ): void {
    const { store, cslProcessor } = update.state.field(bibDataField);
    const analysis = update.state.field(documentAnalysisField);
    const mapped = mappedDecorationsWithFreshWidgetSources(
      this.decorations,
      update.changes,
    );

    let nextDecorations = mapped;
    for (const range of dirtyRanges) {
      nextDecorations = nextDecorations.update({
        filterFrom: range.from,
        filterTo: range.to,
        filter: (from, to) => !rangeIntersectsDirtyRanges(from, to, [range]),
      });
    }

    const dirtyRefs = collectDirtyReferences(analysis.references, dirtyRanges);
    if (dirtyRefs.length > 0) {
      nextDecorations = nextDecorations.update({
        add: collectReferenceRanges(update.view, store, cslProcessor, dirtyRefs),
        sort: true,
      });
    }

    this.decorations = nextDecorations;
  }

  update(update: ViewUpdate): void {
    if (
      update.transactions.some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation) === true
      )
    ) {
      this.rebuildAll(update.view);
      return;
    }

    const referencesChanged = referenceSliceChanged(update.startState, update.state);
    const endFocused = update.view.hasFocus;
    const startFocused = update.focusChanged ? !endFocused : endFocused;
    const beforeActive = getRevealedReferenceTarget(update.startState, startFocused);
    const afterActive = getRevealedReferenceTarget(update.state, endFocused);
    const activeChanged = inlineRevealTargetChanged(beforeActive, afterActive);

    if (
      bibliographyInputsChanged(update.startState, update.state) ||
      blockLabelConfigChanged(update.startState, update.state) ||
      crossrefNumberingChanged(update.startState, update.state)
    ) {
      this.rebuildAll(update.view);
      return;
    }

    if (!update.docChanged && referencesChanged) {
      this.rebuildAll(update.view);
      return;
    }

    if (update.docChanged) {
      if (!referencesChanged && !activeChanged) {
        this.decorations = mappedDecorationsWithFreshWidgetSources(
          this.decorations,
          update.changes,
        );
        return;
      }

      const dirtyRanges = mergeDirtyRangesWithActiveReference(
        dirtyRangesFromChanges(
          update.changes,
          (from, to) => expandChangeRangeToLines(update.state.doc, from, to),
        ),
        activeChanged ? beforeActive : null,
        activeChanged ? afterActive : null,
      );

      if (dirtyRanges.length === 0) {
        this.decorations = mappedDecorationsWithFreshWidgetSources(
          this.decorations,
          update.changes,
        );
        return;
      }

      this.updateDirtyRanges(update, dirtyRanges);
      return;
    }

    if (activeChanged) {
      this.updateDirtyRanges(
        update,
        mergeDirtyRangesWithActiveReference([], beforeActive, afterActive),
      );
    }
  }
}

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
export const referenceRenderPlugin: Extension = ViewPlugin.fromClass(
  ReferenceRenderViewPlugin,
  {
    decorations: (value) => value.decorations,
  },
);
