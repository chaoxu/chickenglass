import {
  type ChangeDesc,
  type EditorState,
  type Text,
} from "@codemirror/state";
import {
  findAttributeIdSpan,
  findBracketedOccurrenceSpan,
  findEquationLabelSpan,
  findHeadingIdSpan,
} from "../references/source-ranges";
import { type DocumentAnalysis } from "./document";
import {
  getEditorDocumentReferenceCatalog,
  getDocumentAnalysisOrRecompute,
} from "./editor-reference-catalog";
import type { DocumentReferenceCatalog } from "./reference-catalog";
import {
  createDocumentLabelGraph,
  findDocumentLabelBacklinks,
  getDocumentLabelDefinition,
  getDocumentLabelDefinitions,
  isValidDocumentLabelId,
  validateDocumentLabelRename,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelKind,
  type DocumentLabelReference,
  type DocumentLabelRenameValidation,
} from "../lib/markdown/label-model";

export type {
  DocumentLabelDefinition,
  DocumentLabelGraph,
  DocumentLabelKind,
  DocumentLabelReference,
  DocumentLabelRenameValidation,
};

function mapDocumentLabelDefinition(
  definition: DocumentLabelDefinition,
  changes: ChangeDesc,
): DocumentLabelDefinition {
  const from = changes.mapPos(definition.from, 1);
  const to = Math.max(from, changes.mapPos(definition.to, -1));
  const tokenFrom = changes.mapPos(definition.tokenFrom, 1);
  const tokenTo = Math.max(tokenFrom, changes.mapPos(definition.tokenTo, -1));
  const labelFrom = changes.mapPos(definition.labelFrom, 1);
  const labelTo = Math.max(labelFrom, changes.mapPos(definition.labelTo, -1));
  if (
    from === definition.from
    && to === definition.to
    && tokenFrom === definition.tokenFrom
    && tokenTo === definition.tokenTo
    && labelFrom === definition.labelFrom
    && labelTo === definition.labelTo
  ) {
    return definition;
  }
  return {
    ...definition,
    from,
    to,
    tokenFrom,
    tokenTo,
    labelFrom,
    labelTo,
  };
}

function mapDocumentLabelReference(
  reference: DocumentLabelReference,
  changes: ChangeDesc,
): DocumentLabelReference {
  const from = changes.mapPos(reference.from, 1);
  const to = Math.max(from, changes.mapPos(reference.to, -1));
  const labelFrom = changes.mapPos(reference.labelFrom, 1);
  const labelTo = Math.max(labelFrom, changes.mapPos(reference.labelTo, -1));
  const clusterFrom = changes.mapPos(reference.clusterFrom, 1);
  const clusterTo = Math.max(clusterFrom, changes.mapPos(reference.clusterTo, -1));
  if (
    from === reference.from
    && to === reference.to
    && labelFrom === reference.labelFrom
    && labelTo === reference.labelTo
    && clusterFrom === reference.clusterFrom
    && clusterTo === reference.clusterTo
  ) {
    return reference;
  }
  return {
    ...reference,
    from,
    to,
    labelFrom,
    labelTo,
    clusterFrom,
    clusterTo,
  };
}

function buildHeadingDefinitions(
  catalog: DocumentReferenceCatalog,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions: DocumentLabelDefinition[] = [];

  for (const heading of catalog.targets) {
    if (heading.kind !== "heading" || !heading.id) continue;
    const span = findHeadingIdSpan(
      doc.sliceString(heading.from, heading.to),
      heading.from,
      heading.id,
    );
    if (!span) continue;
    definitions.push({
      id: heading.id,
      kind: "heading",
      from: heading.from,
      to: heading.to,
      tokenFrom: span.tokenFrom,
      tokenTo: span.tokenTo,
      labelFrom: span.labelFrom,
      labelTo: span.labelTo,
      displayLabel: heading.displayLabel,
      number: heading.number,
      title: heading.title,
    });
  }

  return definitions;
}

function buildEquationDefinitions(
  catalog: DocumentReferenceCatalog,
  analysis: DocumentAnalysis,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions: DocumentLabelDefinition[] = [];
  for (const equation of analysis.equations) {
    const target = catalog.targetsById.get(equation.id)
      ?.find((candidate) => candidate.kind === "equation" && candidate.from === equation.from)
      ?? catalog.targetsById.get(equation.id)
        ?.find((candidate) => candidate.kind === "equation");
    if (!target) continue;

    const span = findEquationLabelSpan(
      doc.sliceString(equation.labelFrom, equation.labelTo),
      equation.labelFrom,
      equation.id,
    );
    if (!span) continue;

    definitions.push({
      id: equation.id,
      kind: "equation",
      from: equation.from,
      to: equation.to,
      tokenFrom: span.tokenFrom,
      tokenTo: span.tokenTo,
      labelFrom: span.labelFrom,
      labelTo: span.labelTo,
      displayLabel: target.displayLabel,
      number: target.number,
      text: target.text,
    });
  }

  return definitions;
}

function buildBlockDefinitions(
  catalog: DocumentReferenceCatalog,
  analysis: DocumentAnalysis,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions: DocumentLabelDefinition[] = [];

  for (const block of catalog.targets) {
    if (block.kind !== "block" || !block.id) continue;
    const div = analysis.fencedDivByFrom.get(block.from);
    if (!div || div.attrFrom === undefined || div.attrTo === undefined) continue;

    const span = findAttributeIdSpan(
      doc.sliceString(div.attrFrom, div.attrTo),
      div.attrFrom,
      block.id,
    );
    if (!span) continue;

    definitions.push({
      id: block.id,
      kind: "block",
      blockType: block.blockType,
      from: block.from,
      to: block.to,
      tokenFrom: span.tokenFrom,
      tokenTo: span.tokenTo,
      labelFrom: span.labelFrom,
      labelTo: span.labelTo,
      displayLabel: block.displayLabel,
      number: block.number,
      title: block.title,
    });
  }

  return definitions;
}

function buildDefinitions(
  catalog: DocumentReferenceCatalog,
  analysis: DocumentAnalysis,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions = [
    ...buildHeadingDefinitions(catalog, doc),
    ...buildBlockDefinitions(catalog, analysis, doc),
    ...buildEquationDefinitions(catalog, analysis, doc),
  ];
  definitions.sort((a, b) => (a.from - b.from) || (a.to - b.to));
  return definitions;
}

function buildReferences(
  catalog: DocumentReferenceCatalog,
  doc: Text,
): DocumentLabelReference[] {
  const references: DocumentLabelReference[] = [];

  for (const ref of catalog.references) {
    if (!ref.bracketed) {
      const id = ref.ids[0];
      if (!id || !catalog.targetsById.has(id)) continue;
      references.push({
        id,
        from: ref.from,
        to: ref.to,
        labelFrom: ref.from + 1,
        labelTo: ref.from + 1 + id.length,
        clusterFrom: ref.from,
        clusterTo: ref.to,
        clusterIndex: 0,
        bracketed: false,
        locator: ref.locators[0],
      });
      continue;
    }

    const raw = doc.sliceString(ref.from, ref.to);
    let searchFrom = 0;
    for (let index = 0; index < ref.ids.length; index += 1) {
      const id = ref.ids[index];
      const span = findBracketedOccurrenceSpan(raw, ref.from, id, searchFrom);
      if (!span) continue;
      searchFrom = span.tokenTo - ref.from;
      if (!catalog.targetsById.has(id)) continue;

      references.push({
        id,
        from: span.tokenFrom,
        to: span.tokenTo,
        labelFrom: span.labelFrom,
        labelTo: span.labelTo,
        clusterFrom: ref.from,
        clusterTo: ref.to,
        clusterIndex: index,
        bracketed: true,
        locator: ref.locators[index],
      });
    }
  }

  return references;
}

export function buildDocumentLabelGraph(state: EditorState): DocumentLabelGraph {
  const analysis = getDocumentAnalysisOrRecompute(state);
  const catalog = getEditorDocumentReferenceCatalog(state, analysis);
  const doc = state.doc;
  const definitions = buildDefinitions(catalog, analysis, doc);
  const references = buildReferences(catalog, doc);

  return createDocumentLabelGraph(definitions, references);
}

export function mapDocumentLabelGraph(
  graph: DocumentLabelGraph,
  changes: ChangeDesc,
): DocumentLabelGraph {
  let definitionsChanged = false;
  const definitions = graph.definitions.map((definition) => {
    const next = mapDocumentLabelDefinition(definition, changes);
    if (next !== definition) definitionsChanged = true;
    return next;
  });

  let referencesChanged = false;
  const references = graph.references.map((reference) => {
    const next = mapDocumentLabelReference(reference, changes);
    if (next !== reference) referencesChanged = true;
    return next;
  });

  if (!definitionsChanged && !referencesChanged) {
    return graph;
  }

  return createDocumentLabelGraph(definitions, references);
}

export {
  findDocumentLabelBacklinks,
  getDocumentLabelDefinition,
  getDocumentLabelDefinitions,
  isValidDocumentLabelId,
  validateDocumentLabelRename,
};
