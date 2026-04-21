import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type ChangeDesc,
  type EditorState,
} from "@codemirror/state";
import type { NumberingScheme } from "../parser/frontmatter";
import { computeBlockNumbersFromFencedDivs } from "../state/block-counter-core";
import { getPluginOrFallback } from "../state/plugin-registry-core";
import { docChangeTouchesFencedDivStructure } from "../fenced-block/model";
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
} from "./document";
import {
  buildDocumentReferenceCatalog,
  mapDocumentReferenceCatalog,
  type BlockReferenceTargetInput,
  type DocumentReferenceCatalog,
} from "./reference-catalog";
import { createChangeChecker } from "../state/change-detection";

export const setExternalDocumentReferenceCatalogEffect =
  StateEffect.define<DocumentReferenceCatalog | null>();

export const externalDocumentReferenceCatalogField =
  StateField.define<DocumentReferenceCatalog | null>({
    create() {
      return null;
    },

    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setExternalDocumentReferenceCatalogEffect)) {
          return effect.value;
        }
      }
      return value;
    },
  });

function completeSyntaxTree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
}

function getEffectiveNumbering(state: EditorState): NumberingScheme {
  return state.field(frontmatterField).config.numbering ?? "grouped";
}

export function getDocumentAnalysisOrRecompute(
  state: EditorState,
): DocumentAnalysis {
  const cached = state.field(documentAnalysisField, false);
  if (cached) {
    return cached;
  }
  return analyzeDocumentSemantics(
    editorStateTextSource(state),
    completeSyntaxTree(state),
  );
}

function buildEditorBlockReferenceTargetInputs(
  state: EditorState,
  analysis: DocumentAnalysis,
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

export function collectEditorBlockReferenceTargetInputs(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): readonly BlockReferenceTargetInput[] {
  const cached = state.field(editorBlockReferenceTargetInputsField, false);
  return cached ?? buildEditorBlockReferenceTargetInputs(state, analysis);
}

function mapBlockReferenceTargetInput(
  value: BlockReferenceTargetInput,
  changes: ChangeDesc,
): BlockReferenceTargetInput {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  if (from === value.from && to === value.to) {
    return value;
  }
  return {
    ...value,
    from,
    to,
  };
}

function mapBlockReferenceTargetInputs(
  values: readonly BlockReferenceTargetInput[],
  changes: ChangeDesc,
): readonly BlockReferenceTargetInput[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapBlockReferenceTargetInput(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

const blockReferenceTargetDependenciesChanged = createChangeChecker(
  (state) => getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "fencedDivs"),
  (state) => state.field(blockCounterField, false),
  (state) => state.field(pluginRegistryField, false),
);

export const editorBlockReferenceTargetInputsField = StateField.define<
  readonly BlockReferenceTargetInput[]
>({
  create(state) {
    return buildEditorBlockReferenceTargetInputs(
      state,
      getDocumentAnalysisOrRecompute(state),
    );
  },

  update(value, tr) {
    if (blockReferenceTargetDependenciesChanged(tr)) {
      return buildEditorBlockReferenceTargetInputs(
        tr.state,
        getDocumentAnalysisOrRecompute(tr.state),
      );
    }
    if (!tr.docChanged) {
      return value;
    }
    return mapBlockReferenceTargetInputs(value, tr.changes);
  },
});

function computeEditorDocumentReferenceCatalog(
  state: EditorState,
  analysis = getDocumentAnalysisOrRecompute(state),
): DocumentReferenceCatalog {
  return buildDocumentReferenceCatalog(analysis, {
    blocks: state.field(editorBlockReferenceTargetInputsField, false)
      ?? collectEditorBlockReferenceTargetInputs(state, analysis),
  });
}

function sameHeadingTargetMetadataList(
  left: DocumentAnalysis["headings"],
  right: DocumentAnalysis["headings"],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.level !== after.level
      || before.text !== after.text
      || before.id !== after.id
      || before.number !== after.number
      || before.unnumbered !== after.unnumbered
    ) {
      return false;
    }
  }
  return true;
}

function sameEquationTargetMetadataList(
  left: DocumentAnalysis["equations"],
  right: DocumentAnalysis["equations"],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.id !== after.id
      || before.number !== after.number
      || before.latex !== after.latex
    ) {
      return false;
    }
  }
  return true;
}

function canMapReferenceCatalogTargets(
  tr: { readonly startState: EditorState; readonly state: EditorState; readonly changes: ChangeDesc },
): boolean {
  const beforeAnalysis = getDocumentAnalysisOrRecompute(tr.startState);
  const afterAnalysis = getDocumentAnalysisOrRecompute(tr.state);
  if (!sameHeadingTargetMetadataList(beforeAnalysis.headings, afterAnalysis.headings)) {
    return false;
  }
  if (!sameEquationTargetMetadataList(beforeAnalysis.equations, afterAnalysis.equations)) {
    return false;
  }

  const beforeBlocks = tr.startState.field(editorBlockReferenceTargetInputsField, false)
    ?? buildEditorBlockReferenceTargetInputs(tr.startState, beforeAnalysis);
  const afterBlocks = tr.state.field(editorBlockReferenceTargetInputsField, false)
    ?? buildEditorBlockReferenceTargetInputs(tr.state, afterAnalysis);
  const beforeNumberingKey = tr.startState.field(blockCounterField, false)?.numberingKey ?? "";
  const afterNumberingKey = tr.state.field(blockCounterField, false)?.numberingKey ?? "";
  if (beforeBlocks.length !== afterBlocks.length) {
    return false;
  }
  return beforeNumberingKey === afterNumberingKey
    && !docChangeTouchesFencedDivStructure(tr);
}

const referenceCatalogDependenciesChanged = createChangeChecker(
  (state) => getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "headings"),
  (state) => getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "fencedDivs"),
  (state) => getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "equations"),
  (state) => getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "references"),
  (state) => state.field(blockCounterField, false),
  (state) => state.field(pluginRegistryField, false),
);

export const documentReferenceCatalogField = StateField.define<DocumentReferenceCatalog>({
  create(state) {
    return computeEditorDocumentReferenceCatalog(state);
  },

  update(value, tr) {
    if (!referenceCatalogDependenciesChanged(tr)) {
      return value;
    }
    const analysis = getDocumentAnalysisOrRecompute(tr.state);
    if (tr.docChanged && canMapReferenceCatalogTargets(tr)) {
      return mapDocumentReferenceCatalog(value, tr.changes, analysis.references);
    }
    return computeEditorDocumentReferenceCatalog(tr.state, analysis);
  },
});

export function getEditorDocumentReferenceCatalog(
  state: EditorState,
  ...analysisArg: [analysis?: DocumentAnalysis]
): DocumentReferenceCatalog {
  const external = state.field(externalDocumentReferenceCatalogField, false);
  if (external) {
    return external;
  }
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
