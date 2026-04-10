import type { EditorState } from "@codemirror/state";

import type { CslProcessor } from "../citations/csl-processor";
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
import {
  getEquationNumbersCacheKey,
  type DocumentAnalysis,
} from "../semantics/document";
import type { PluginRegistryState } from "../plugins/plugin-registry";

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

interface OptionalReferenceRenderState {
  readonly analysis: DocumentAnalysis | null;
  readonly bibliography: ReferenceRenderBibliographyState | null;
  readonly blockCounter: BlockCounterState | undefined;
  readonly pluginRegistry: PluginRegistryState | null;
}

function readOptionalReferenceRenderState(
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
  return {
    analysis: getReferenceRenderAnalysis(state),
    bibliography: state.field(bibDataField),
    blockCounter: state.field(blockCounterField, false) ?? undefined,
    pluginRegistry: state.field(pluginRegistryField, false) ?? null,
  };
}

export function getReferenceRenderAnalysis(
  state: EditorState,
): DocumentAnalysis {
  return state.field(documentAnalysisField);
}

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

const bibliographyInputsChanged = createChangeChecker(
  (state) => state.field(bibDataField, false)?.store ?? null,
  (state) => state.field(bibDataField, false)?.cslProcessor ?? null,
  (state) => state.field(bibDataField, false)?.processorRevision ?? null,
);

const blockLabelConfigChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField, false),
);

export function referenceRenderRebuildDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  return (
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

export function getReferenceRenderDependencySignature(
  state: EditorState,
): string {
  const {
    analysis,
    bibliography,
    pluginRegistry,
  } = readOptionalReferenceRenderState(state);
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
    getObjectIdentityId(store as object),
    getObjectIdentityId(cslProcessor),
    processorRevision,
    cslProcessor.citationRegistrationKey ?? "",
    getObjectIdentityId(pluginRegistry),
  ].join("\u0001");
}
