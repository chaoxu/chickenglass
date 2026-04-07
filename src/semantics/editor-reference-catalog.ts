import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { blockCounterField } from "../plugins/block-counter";
import { getPluginOrFallback, pluginRegistryField } from "../plugins/plugin-registry";
import { documentAnalysisField, editorStateTextSource } from "./codemirror-source";
import {
  analyzeDocumentSemantics,
  type DocumentAnalysis,
  type EquationSemantics,
  type FencedDivSemantics,
  type FootnoteSemantics,
  type HeadingSemantics,
  type IncludeSemantics,
  type ReferenceSemantics,
} from "./document";
import {
  buildDocumentReferenceCatalog,
  type BlockReferenceTargetInput,
  type DocumentReferenceCatalog,
} from "./reference-catalog";

function countLabeledHeadings(headings: readonly HeadingSemantics[]): number {
  return headings.reduce((count, heading) => count + (heading.id ? 1 : 0), 0);
}

function chooseHeadings(
  cached: readonly HeadingSemantics[],
  recomputed: readonly HeadingSemantics[],
): readonly HeadingSemantics[] {
  const cachedScore = countLabeledHeadings(cached);
  const recomputedScore = countLabeledHeadings(recomputed);
  if (recomputedScore !== cachedScore) {
    return recomputedScore > cachedScore ? recomputed : cached;
  }
  return recomputed.length > cached.length ? recomputed : cached;
}

function chooseLongerSlice<T>(
  cached: readonly T[],
  recomputed: readonly T[],
): readonly T[] {
  return recomputed.length > cached.length ? recomputed : cached;
}

function buildByFromMap<T extends { readonly from: number }>(
  items: readonly T[],
): ReadonlyMap<number, T> {
  return new Map(items.map((item) => [item.from, item]));
}

function buildEquationById(
  equations: readonly EquationSemantics[],
): ReadonlyMap<string, EquationSemantics> {
  const byId = new Map<string, EquationSemantics>();
  for (const equation of equations) {
    byId.set(equation.id, equation);
  }
  return byId;
}

function chooseFootnotes(
  cached: FootnoteSemantics,
  recomputed: FootnoteSemantics,
): FootnoteSemantics {
  const cachedScore = cached.refs.length + cached.defs.size;
  const recomputedScore = recomputed.refs.length + recomputed.defs.size;
  return recomputedScore > cachedScore ? recomputed : cached;
}

export function getDocumentAnalysisOrRecompute(
  state: EditorState,
): DocumentAnalysis {
  const recomputed = analyzeDocumentSemantics(
    editorStateTextSource(state),
    syntaxTree(state),
  );
  const cached = state.field(documentAnalysisField, false);
  if (!cached) return recomputed;

  const headings = chooseHeadings(cached.headings, recomputed.headings);
  const fencedDivs = chooseLongerSlice(cached.fencedDivs, recomputed.fencedDivs);
  const equations = chooseLongerSlice(cached.equations, recomputed.equations);
  const references = chooseLongerSlice(cached.references, recomputed.references);
  const mathRegions = chooseLongerSlice(cached.mathRegions, recomputed.mathRegions);
  const includes = chooseLongerSlice(cached.includes, recomputed.includes);

  return {
    ...cached,
    headings,
    headingByFrom: buildByFromMap(headings),
    footnotes: chooseFootnotes(cached.footnotes, recomputed.footnotes),
    fencedDivs,
    fencedDivByFrom: buildByFromMap<FencedDivSemantics>(fencedDivs),
    equations,
    equationById: buildEquationById(equations),
    mathRegions,
    references,
    referenceByFrom: buildByFromMap<ReferenceSemantics>(references),
    includes,
    includeByFrom: buildByFromMap<IncludeSemantics>(includes),
  };
}

export function collectEditorBlockReferenceTargetInputs(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): readonly BlockReferenceTargetInput[] {
  const counters = state.field(blockCounterField, false);
  if (!counters) return [];

  const registry = state.field(pluginRegistryField, false);
  return counters.blocks.map((block) => ({
    from: block.from,
    to: block.to,
    id: block.id,
    blockType: block.type,
    title: analysis.fencedDivByFrom.get(block.from)?.title,
    displayTitle: registry
      ? getPluginOrFallback(registry, block.type)?.title ?? block.type
      : block.type,
    number: block.number,
  }));
}

export function buildEditorDocumentReferenceCatalog(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): DocumentReferenceCatalog {
  return buildDocumentReferenceCatalog(analysis, {
    blocks: collectEditorBlockReferenceTargetInputs(state, analysis),
  });
}
