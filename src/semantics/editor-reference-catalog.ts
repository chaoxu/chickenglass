import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Transaction } from "@codemirror/state";
import type { NumberingScheme } from "../parser/frontmatter";
import { computeBlockNumbersFromFencedDivs } from "../plugins/block-counter";
import { getPluginOrFallback } from "../plugins/plugin-registry";
import { classifyReferenceIndex } from "../references/classifier";
import { blockCounterField } from "../state/block-counter";
import { frontmatterField } from "../state/frontmatter-state";
import { pluginRegistryField } from "../state/plugin-registry";
import {
  documentAnalysisField,
  editorStateTextSource,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
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

type DocumentAnalysisBase = Omit<DocumentAnalysis, "referenceIndex">;

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

function completeSyntaxTree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
}

function getEffectiveNumbering(state: EditorState): NumberingScheme {
  return state.field(frontmatterField).config.numbering ?? "grouped";
}

export function getDocumentAnalysisOrRecompute(
  state: EditorState,
): DocumentAnalysis {
  const recomputed = analyzeDocumentSemantics(
    editorStateTextSource(state),
    completeSyntaxTree(state),
  );
  const cached = state.field(documentAnalysisField, false);
  if (!cached) return recomputed;

  const headings = chooseHeadings(cached.headings, recomputed.headings);
  const fencedDivs = chooseLongerSlice(cached.fencedDivs, recomputed.fencedDivs);
  const equations = chooseLongerSlice(cached.equations, recomputed.equations);
  const references = chooseLongerSlice(cached.references, recomputed.references);
  const mathRegions = chooseLongerSlice(cached.mathRegions, recomputed.mathRegions);
  const includes = chooseLongerSlice(cached.includes, recomputed.includes);
  const footnotes = chooseFootnotes(cached.footnotes, recomputed.footnotes);

  const analysis: DocumentAnalysisBase = {
    headings,
    headingByFrom: buildByFromMap(headings),
    footnotes,
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
  return {
    ...analysis,
    referenceIndex: classifyReferenceIndex(editorStateTextSource(state), analysis),
  };
}

export function collectEditorBlockReferenceTargetInputs(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): readonly BlockReferenceTargetInput[] {
  const registry = state.field(pluginRegistryField, false);
  if (!registry) return [];

  const counters = state.field(blockCounterField, false);
  const recomputedCounters = computeBlockNumbersFromFencedDivs(
    analysis.fencedDivs,
    registry,
    getEffectiveNumbering(state),
  );
  const blockNumbers = counters && counters.blocks.length === recomputedCounters.blocks.length
    ? counters
    : recomputedCounters;

  return blockNumbers.blocks.map((block) => ({
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

function computeEditorDocumentReferenceCatalog(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): DocumentReferenceCatalog {
  return buildDocumentReferenceCatalog(analysis, {
    blocks: collectEditorBlockReferenceTargetInputs(state, analysis),
  });
}

function referenceCatalogDependenciesChanged(tr: Transaction): boolean {
  const beforeAnalysis = tr.startState.field(documentAnalysisField);
  const afterAnalysis = tr.state.field(documentAnalysisField);
  return (
    getDocumentAnalysisSliceRevision(beforeAnalysis, "headings")
      !== getDocumentAnalysisSliceRevision(afterAnalysis, "headings") ||
    getDocumentAnalysisSliceRevision(beforeAnalysis, "fencedDivs")
      !== getDocumentAnalysisSliceRevision(afterAnalysis, "fencedDivs") ||
    getDocumentAnalysisSliceRevision(beforeAnalysis, "equations")
      !== getDocumentAnalysisSliceRevision(afterAnalysis, "equations") ||
    getDocumentAnalysisSliceRevision(beforeAnalysis, "references")
      !== getDocumentAnalysisSliceRevision(afterAnalysis, "references") ||
    tr.startState.field(blockCounterField, false) !== tr.state.field(blockCounterField, false) ||
    tr.startState.field(pluginRegistryField, false) !== tr.state.field(pluginRegistryField, false)
  );
}

export const documentReferenceCatalogField = StateField.define<DocumentReferenceCatalog>({
  create(state) {
    return computeEditorDocumentReferenceCatalog(state);
  },

  update(value, tr) {
    if (!referenceCatalogDependenciesChanged(tr)) {
      return value;
    }
    return computeEditorDocumentReferenceCatalog(tr.state);
  },
});

export function getEditorDocumentReferenceCatalog(
  state: EditorState,
  ...analysisArg: [analysis?: DocumentAnalysis]
): DocumentReferenceCatalog {
  const [analysis] = analysisArg;
  const cached = state.field(documentReferenceCatalogField, false);
  if (analysisArg.length === 0 && cached) {
    return cached;
  }
  return computeEditorDocumentReferenceCatalog(
    state,
    analysis ?? getDocumentAnalysisOrRecompute(state),
  );
}

export function buildEditorDocumentReferenceCatalog(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): DocumentReferenceCatalog {
  return computeEditorDocumentReferenceCatalog(state, analysis);
}
