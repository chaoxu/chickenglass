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

const EMPTY_DEFINITIONS: readonly DocumentLabelDefinition[] = [];
const EMPTY_REFERENCES: readonly DocumentLabelReference[] = [];
const LOCAL_LABEL_RE = /^[A-Za-z0-9_][\w.:-]*$/;

export type DocumentLabelKind = "block" | "equation" | "heading";

export interface DocumentLabelDefinition {
  readonly id: string;
  readonly kind: DocumentLabelKind;
  readonly from: number;
  readonly to: number;
  readonly tokenFrom: number;
  readonly tokenTo: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly displayLabel: string;
  readonly number?: string;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
}

export interface DocumentLabelReference {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly clusterFrom: number;
  readonly clusterTo: number;
  readonly clusterIndex: number;
  readonly bracketed: boolean;
  readonly locator?: string;
}

export interface DocumentLabelRenameValidation {
  readonly ok: boolean;
  readonly id: string;
  readonly reason?: "empty" | "invalid-format" | "collision";
  readonly conflictingDefinitions?: readonly DocumentLabelDefinition[];
}

export interface DocumentLabelGraph {
  readonly definitions: readonly DocumentLabelDefinition[];
  readonly definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>;
  readonly uniqueDefinitionById: ReadonlyMap<string, DocumentLabelDefinition>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>;
  readonly references: readonly DocumentLabelReference[];
  readonly referencesByTarget: ReadonlyMap<string, readonly DocumentLabelReference[]>;
}

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

function buildDefinitionsById(
  definitions: readonly DocumentLabelDefinition[],
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const byId = new Map<string, DocumentLabelDefinition[]>();
  for (const definition of definitions) {
    const bucket = byId.get(definition.id);
    if (bucket) {
      bucket.push(definition);
    } else {
      byId.set(definition.id, [definition]);
    }
  }
  return byId;
}

function buildUniqueDefinitionById(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, DocumentLabelDefinition> {
  const unique = new Map<string, DocumentLabelDefinition>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length === 1) {
      unique.set(id, definitions[0]);
    }
  }
  return unique;
}

function buildDuplicatesById(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const duplicates = new Map<string, readonly DocumentLabelDefinition[]>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length > 1) {
      duplicates.set(id, definitions);
    }
  }
  return duplicates;
}

function buildReferencesByTarget(
  references: readonly DocumentLabelReference[],
): ReadonlyMap<string, readonly DocumentLabelReference[]> {
  const byTarget = new Map<string, DocumentLabelReference[]>();
  for (const reference of references) {
    const bucket = byTarget.get(reference.id);
    if (bucket) {
      bucket.push(reference);
    } else {
      byTarget.set(reference.id, [reference]);
    }
  }
  return byTarget;
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

export function isValidDocumentLabelId(id: string): boolean {
  return LOCAL_LABEL_RE.test(id);
}

export function buildDocumentLabelGraph(state: EditorState): DocumentLabelGraph {
  const analysis = getDocumentAnalysisOrRecompute(state);
  const catalog = getEditorDocumentReferenceCatalog(state, analysis);
  const doc = state.doc;
  const definitions = buildDefinitions(catalog, analysis, doc);
  const definitionsById = buildDefinitionsById(definitions);
  const references = buildReferences(catalog, doc);

  return {
    definitions,
    definitionsById,
    uniqueDefinitionById: buildUniqueDefinitionById(definitionsById),
    duplicatesById: buildDuplicatesById(definitionsById),
    references,
    referencesByTarget: buildReferencesByTarget(references),
  };
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

  const definitionsById = buildDefinitionsById(definitions);
  return {
    definitions,
    definitionsById,
    uniqueDefinitionById: buildUniqueDefinitionById(definitionsById),
    duplicatesById: buildDuplicatesById(definitionsById),
    references,
    referencesByTarget: buildReferencesByTarget(references),
  };
}

export function getDocumentLabelDefinitions(
  graph: DocumentLabelGraph,
  id: string,
): readonly DocumentLabelDefinition[] {
  return graph.definitionsById.get(id) ?? EMPTY_DEFINITIONS;
}

export function getDocumentLabelDefinition(
  graph: DocumentLabelGraph,
  id: string,
): DocumentLabelDefinition | undefined {
  return graph.uniqueDefinitionById.get(id);
}

export function findDocumentLabelBacklinks(
  graph: DocumentLabelGraph,
  id: string,
): readonly DocumentLabelReference[] {
  return graph.referencesByTarget.get(id) ?? EMPTY_REFERENCES;
}

export function validateDocumentLabelRename(
  graph: DocumentLabelGraph,
  nextId: string,
  options: { currentId?: string } = {},
): DocumentLabelRenameValidation {
  const candidate = nextId.trim();
  if (candidate.length === 0) {
    return { ok: false, id: candidate, reason: "empty" };
  }

  if (candidate !== nextId || !isValidDocumentLabelId(candidate)) {
    return { ok: false, id: candidate, reason: "invalid-format" };
  }

  if (candidate === options.currentId) {
    return { ok: true, id: candidate };
  }

  const conflictingDefinitions = graph.definitionsById.get(candidate);
  if (conflictingDefinitions) {
    return {
      ok: false,
      id: candidate,
      reason: "collision",
      conflictingDefinitions,
    };
  }

  return { ok: true, id: candidate };
}
