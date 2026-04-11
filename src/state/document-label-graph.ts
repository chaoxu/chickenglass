import { StateField } from "@codemirror/state";
import {
  buildDocumentLabelGraph,
  mapDocumentLabelGraph,
  type DocumentLabelGraph,
} from "../semantics/document-label-graph";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import type {
  DocumentReferenceCatalog,
  DocumentReferenceTarget,
} from "../semantics/reference-catalog";
import type { ReferenceSemantics } from "../semantics/document";
import { blockCounterField } from "./block-counter";
import { createChangeChecker } from "./change-detection";
import { documentAnalysisField } from "./document-analysis";
import { pluginRegistryField } from "./plugin-registry";

const graphDependenciesChanged = createChangeChecker(
  { doc: true },
  (state) => state.field(documentAnalysisField),
  (state) => state.field(blockCounterField, false),
  (state) => state.field(pluginRegistryField, false),
);

function sameDocumentReferenceTargetMetadata(
  left: readonly DocumentReferenceTarget[],
  right: readonly DocumentReferenceTarget[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before.id !== after.id
      || before.kind !== after.kind
      || before.displayLabel !== after.displayLabel
      || before.number !== after.number
      || before.ordinal !== after.ordinal
      || before.title !== after.title
      || before.text !== after.text
      || before.blockType !== after.blockType
    ) {
      return false;
    }
  }
  return true;
}

function sameReferenceMetadata(
  left: readonly ReferenceSemantics[],
  right: readonly ReferenceSemantics[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (before.bracketed !== after.bracketed) {
      return false;
    }
    if (before.ids.length !== after.ids.length || before.locators.length !== after.locators.length) {
      return false;
    }
    for (let idIndex = 0; idIndex < before.ids.length; idIndex += 1) {
      if (before.ids[idIndex] !== after.ids[idIndex]) {
        return false;
      }
    }
    for (let locatorIndex = 0; locatorIndex < before.locators.length; locatorIndex += 1) {
      if (before.locators[locatorIndex] !== after.locators[locatorIndex]) {
        return false;
      }
    }
  }
  return true;
}

function canMapDocumentLabelGraphTargets(
  beforeCatalog: DocumentReferenceCatalog | undefined,
  afterCatalog: DocumentReferenceCatalog | undefined,
): boolean {
  if (!beforeCatalog || !afterCatalog) {
    return false;
  }
  return sameDocumentReferenceTargetMetadata(beforeCatalog.targets, afterCatalog.targets)
    && sameReferenceMetadata(beforeCatalog.references, afterCatalog.references);
}

export const documentLabelGraphField = StateField.define<DocumentLabelGraph>({
  create(state) {
    return buildDocumentLabelGraph(state);
  },

  update(value, tr) {
    if (!graphDependenciesChanged(tr)) {
      return value;
    }
    if (
      tr.docChanged
      && canMapDocumentLabelGraphTargets(
        tr.startState.field(documentReferenceCatalogField, false),
        tr.state.field(documentReferenceCatalogField, false),
      )
    ) {
      return mapDocumentLabelGraph(value, tr.changes);
    }
    return buildDocumentLabelGraph(tr.state);
  },
});
