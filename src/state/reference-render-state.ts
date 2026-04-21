import type { EditorState } from "@codemirror/state";

import {
  collectCitationMatches,
  getCitationRegistrationKey,
  type CslProcessor,
} from "../citations/csl-processor";
import type { CitationRenderData } from "../citations/citation-render-data";
import type { BibStore } from "./bib-data";
import { bibDataField } from "./bib-data";
import type { BlockCounterState } from "./block-counter";
import { blockCounterField } from "./block-counter";
import { createChangeChecker } from "./change-detection";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "./document-analysis";
import { pluginRegistryField } from "./plugin-registry";
import { externalDocumentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import {
  getEquationNumbersCacheKey,
  type DocumentAnalysis,
  type ReferenceSemantics,
} from "../semantics/document";
import type { PluginRegistryState } from "./plugin-registry-core";

/**
 * Canonical document-state bundle for the reference renderer.
 *
 * This is the preferred `src/state/` pattern for consumers that need
 * multiple cross-subsystem state owners at once: compose them here, then let
 * the render consumer import one state module instead of several unrelated
 * field owners.
 */
export interface ReferenceRenderState {
  readonly analysis: DocumentAnalysis;
  readonly bibliography: ReferenceRenderBibliographyState;
  readonly blockCounter: BlockCounterState | undefined;
  readonly pluginRegistry: PluginRegistryState | null;
}

export interface ReferenceRenderBibliographyState {
  readonly store: BibStore;
  readonly cslProcessor: CslProcessor;
  readonly processorRevision: number;
}

export interface ReferenceRenderIndexEntry {
  readonly blockType?: string;
  readonly kind: "block" | "citation" | "equation" | "footnote" | "heading";
  readonly label: string;
  readonly shortLabel?: string;
}

export interface ReferenceRenderIndex {
  readonly footnotes: ReadonlyMap<string, number>;
  readonly references: ReadonlyMap<string, ReferenceRenderIndexEntry>;
}

export interface ReferenceRenderLabelDefinition {
  readonly blockType?: string;
  readonly content?: string;
  readonly displayLabel?: string;
  readonly from?: number;
  readonly id: string;
  readonly kind: "block" | "equation" | "heading";
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly text?: string;
  readonly title?: string;
  readonly to?: number;
  readonly tokenFrom?: number;
  readonly tokenTo?: number;
}

export interface ReferenceRenderLabelGraph {
  readonly definitions?: readonly ReferenceRenderLabelDefinition[];
  readonly definitionsById?: ReadonlyMap<string, readonly ReferenceRenderLabelDefinition[]>;
  readonly duplicatesById?: ReadonlyMap<string, readonly ReferenceRenderLabelDefinition[]>;
  readonly references?: readonly unknown[];
  readonly referencesByTarget?: ReadonlyMap<string, readonly unknown[]>;
  readonly uniqueDefinitionById: ReadonlyMap<string, ReferenceRenderLabelDefinition>;
}

export interface ReferenceRenderDependencies {
  readonly renderIndex: ReferenceRenderIndex;
  readonly footnoteDefinitions: ReadonlyMap<string, string>;
  readonly citations: CitationRenderData;
  readonly labelGraph: ReferenceRenderLabelGraph;
}

interface OptionalReferenceRenderState {
  readonly analysis: DocumentAnalysis | null;
  readonly bibliography: ReferenceRenderBibliographyState | null;
  readonly blockCounter: BlockCounterState | undefined;
  readonly pluginRegistry: PluginRegistryState | null;
}

export function getOptionalReferenceRenderState(
  state: EditorState,
): OptionalReferenceRenderState {
  return {
    analysis: state.field(documentAnalysisField, false) ?? null,
    bibliography: state.field(bibDataField, false) ?? null,
    blockCounter: state.field(blockCounterField, false) ?? undefined,
    pluginRegistry: state.field(pluginRegistryField, false) ?? null,
  };
}

export function getReferenceRenderState(
  state: EditorState,
): ReferenceRenderState {
  const optional = getOptionalReferenceRenderState(state);
  if (!optional.analysis || !optional.bibliography) {
    throw new RangeError("Reference render state is unavailable in this editor state.");
  }
  return {
    analysis: optional.analysis,
    bibliography: optional.bibliography,
    blockCounter: optional.blockCounter,
    pluginRegistry: optional.pluginRegistry,
  };
}

export function getReferenceRenderAnalysis(
  state: EditorState,
): DocumentAnalysis {
  return state.field(documentAnalysisField);
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
  return state.field(blockCounterField, false)?.numberingKey ?? "";
}

export const referenceRenderSliceChanged = createChangeChecker(
  (state) => getReferenceRenderAnalysis(state).references,
  (state) => getReferenceRenderAnalysis(state).referenceByFrom,
  (state) => getDocumentAnalysisSliceRevision(getReferenceRenderAnalysis(state), "references"),
);

function getEquationNumberingSnapshot(state: EditorState) {
  const analysis = getReferenceRenderAnalysis(state);
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

const externalReferenceCatalogChanged = createChangeChecker(
  (state) => state.field(externalDocumentReferenceCatalogField, false),
);

const bibliographyInputsChanged = createChangeChecker(
  (state) => state.field(bibDataField, false)?.store ?? null,
  (state) => state.field(bibDataField, false)?.cslProcessor ?? null,
  (state) => state.field(bibDataField, false)?.processorRevision ?? null,
);

interface CitationRegistrationSnapshot {
  readonly references: readonly ReferenceSemantics[] | null;
  readonly store: BibStore | null;
}

interface CitationClusterScan {
  readonly nextIndex: number;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

function nextCitationClusterScan(
  references: readonly ReferenceSemantics[],
  store: BibStore,
  startIndex: number,
): CitationClusterScan | null {
  for (let index = startIndex; index < references.length; index += 1) {
    const reference = references[index];
    let ids: string[] | null = null;
    let locators: (string | undefined)[] | null = null;

    for (let idIndex = 0; idIndex < reference.ids.length; idIndex += 1) {
      const id = reference.ids[idIndex];
      if (!store.has(id)) continue;
      ids ??= [];
      locators ??= [];
      ids.push(id);
      locators.push(reference.locators[idIndex]);
    }

    if (ids) {
      return {
        nextIndex: index + 1,
        ids,
        locators: locators ?? [],
      };
    }
  }

  return null;
}

function sameCitationRegistrationInputs(
  left: readonly ReferenceSemantics[],
  right: readonly ReferenceSemantics[],
  store: BibStore,
): boolean {
  let leftIndex = 0;
  let rightIndex = 0;

  for (;;) {
    const leftCluster = nextCitationClusterScan(left, store, leftIndex);
    const rightCluster = nextCitationClusterScan(right, store, rightIndex);

    if (!leftCluster || !rightCluster) {
      return leftCluster === rightCluster;
    }

    if (leftCluster.ids.length !== rightCluster.ids.length) {
      return false;
    }

    for (let index = 0; index < leftCluster.ids.length; index += 1) {
      if (leftCluster.ids[index] !== rightCluster.ids[index]) {
        return false;
      }
      if (leftCluster.locators[index] !== rightCluster.locators[index]) {
        return false;
      }
    }

    leftIndex = leftCluster.nextIndex;
    rightIndex = rightCluster.nextIndex;
  }
}

function getCitationRegistrationSnapshot(
  state: EditorState,
): CitationRegistrationSnapshot {
  const analysis = state.field(documentAnalysisField, false) ?? null;
  const bibliography = state.field(bibDataField, false) ?? null;
  return {
    references: analysis?.references ?? null,
    store: bibliography?.store ?? null,
  };
}

function sameCitationRegistrationSnapshot(
  before: CitationRegistrationSnapshot,
  after: CitationRegistrationSnapshot,
): boolean {
  if (before.store !== after.store) {
    return false;
  }
  if (!before.store) {
    return before.references === after.references;
  }
  if (!before.references || !after.references) {
    return before.references === after.references;
  }
  return sameCitationRegistrationInputs(before.references, after.references, before.store);
}

const citationRegistrationInputsChanged = createChangeChecker({
  get: getCitationRegistrationSnapshot,
  equals: sameCitationRegistrationSnapshot,
});

const blockLabelConfigChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField, false),
);

export function referenceRenderRebuildDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  return (
    externalReferenceCatalogChanged(beforeState, afterState) ||
    bibliographyInputsChanged(beforeState, afterState) ||
    blockLabelConfigChanged(beforeState, afterState) ||
    crossrefNumberingChanged(beforeState, afterState)
  );
}

export function referenceRenderDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  return (
    referenceRenderRebuildDependenciesChanged(beforeState, afterState) ||
    referenceRenderSliceChanged(beforeState, afterState)
  );
}

export function tableReferenceRenderDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  const beforeAnalysis = beforeState.field(documentAnalysisField, false);
  const afterAnalysis = afterState.field(documentAnalysisField, false);

  const sharedOwnersChanged = (
    externalReferenceCatalogChanged(beforeState, afterState) ||
    bibliographyInputsChanged(beforeState, afterState) ||
    blockLabelConfigChanged(beforeState, afterState)
  );

  if (!beforeAnalysis || !afterAnalysis) {
    return sharedOwnersChanged;
  }

  return (
    sharedOwnersChanged ||
    crossrefNumberingChanged(beforeState, afterState)
    || citationRegistrationInputsChanged(beforeState, afterState)
  );
}

export function getReferenceRenderDependencySignature(
  state: EditorState,
): string {
  const {
    analysis,
    bibliography,
    pluginRegistry,
  } = getOptionalReferenceRenderState(state);
  if (!analysis || !bibliography) {
    return [
      "",
      "",
      "",
      0,
      0,
      0,
      "",
      getObjectIdentityId(pluginRegistry),
    ].join("\u0001");
  }
  const { store, cslProcessor, processorRevision } = bibliography;

  return [
    getDocumentAnalysisSliceRevision(analysis, "references"),
    getEquationNumbersCacheKey(analysis),
    getBlockNumberingKey(state),
    getObjectIdentityId(state.field(externalDocumentReferenceCatalogField, false)),
    getObjectIdentityId(store as object),
    getObjectIdentityId(cslProcessor),
    processorRevision,
    cslProcessor.citationRegistrationKey ?? "",
    getObjectIdentityId(pluginRegistry),
  ].join("\u0001");
}

export function getTableReferenceRenderDependencySignature(
  state: EditorState,
): string {
  const {
    analysis,
    bibliography,
    pluginRegistry,
  } = getOptionalReferenceRenderState(state);
  if (!analysis || !bibliography) {
    return [
      "",
      "",
      "",
      0,
      0,
      0,
      "",
      getObjectIdentityId(pluginRegistry),
    ].join("\u0001");
  }

  const { store, cslProcessor, processorRevision } = bibliography;
  const citationRegistrationKey = getCitationRegistrationKey(
    collectCitationMatches(analysis.references, store),
  );

  return [
    citationRegistrationKey,
    getEquationNumbersCacheKey(analysis),
    getBlockNumberingKey(state),
    getObjectIdentityId(state.field(externalDocumentReferenceCatalogField, false)),
    getObjectIdentityId(store as object),
    getObjectIdentityId(cslProcessor),
    processorRevision,
    getObjectIdentityId(pluginRegistry),
  ].join("\u0001");
}
