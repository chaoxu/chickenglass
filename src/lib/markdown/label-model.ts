import type { DocumentLabelReference } from "./label-parser";
import { REFERENCE_ID_SOURCE } from "../reference-grammar";
export type { DocumentLabelReference } from "./label-parser";

const EMPTY_DEFINITIONS: readonly DocumentLabelDefinition[] = [];
const EMPTY_REFERENCES: readonly DocumentLabelReference[] = [];
const LOCAL_LABEL_RE = new RegExp(`^(?:${REFERENCE_ID_SOURCE})$`);

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
  readonly content?: string;
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

export interface DocumentLabelRenameTarget {
  readonly definition: DocumentLabelDefinition;
  readonly references: readonly DocumentLabelReference[];
}

export type DocumentLabelRenameTargetLookup =
  | {
    readonly kind: "target";
    readonly target: DocumentLabelRenameTarget;
  }
  | {
    readonly kind: "duplicate";
    readonly id: string;
    readonly definitions: readonly DocumentLabelDefinition[];
  }
  | {
    readonly kind: "none";
  };

export type DocumentLabelBacklinkTargetLookup =
  | {
    readonly kind: "target";
    readonly source: "definition" | "reference" | "selection";
    readonly target: DocumentLabelRenameTarget;
  }
  | {
    readonly kind: "duplicate";
    readonly id: string;
    readonly definitions: readonly DocumentLabelDefinition[];
  }
  | {
    readonly kind: "none";
  };

export type DocumentLabelChange = {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
};

export interface DocumentLabelRenamePlanReady {
  readonly kind: "ready";
  readonly definition: DocumentLabelDefinition;
  readonly currentId: string;
  readonly nextId: string;
  readonly referenceCount: number;
  readonly changes: readonly DocumentLabelChange[];
}

export interface DocumentLabelRenamePlanInvalid {
  readonly kind: "invalid";
  readonly definition: DocumentLabelDefinition;
  readonly currentId: string;
  readonly referenceCount: number;
  readonly validation: DocumentLabelRenameValidation;
}

export type DocumentLabelRenamePlan =
  | DocumentLabelRenamePlanReady
  | DocumentLabelRenamePlanInvalid
  | DocumentLabelRenameTargetLookup;

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

function canonicalDefinitions(
  definitions: readonly DocumentLabelDefinition[],
): readonly DocumentLabelDefinition[] {
  return [...definitions].sort((left, right) =>
    (left.from - right.from) || (left.to - right.to));
}

function filterLocalReferences(
  references: readonly DocumentLabelReference[],
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): readonly DocumentLabelReference[] {
  return references.filter((reference) => definitionsById.has(reference.id));
}

export function createDocumentLabelGraph(
  definitionsInput: readonly DocumentLabelDefinition[],
  referencesInput: readonly DocumentLabelReference[],
): DocumentLabelGraph {
  const definitions = canonicalDefinitions(definitionsInput);
  const definitionsById = buildDefinitionsById(definitions);
  const references = filterLocalReferences(referencesInput, definitionsById);
  return {
    definitions,
    definitionsById,
    uniqueDefinitionById: buildUniqueDefinitionById(definitionsById),
    duplicatesById: buildDuplicatesById(definitionsById),
    references,
    referencesByTarget: buildReferencesByTarget(references),
  };
}

export function isValidDocumentLabelId(id: string): boolean {
  return LOCAL_LABEL_RE.test(id);
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

function selectionTouchesRange(
  selectionFrom: number,
  selectionTo: number,
  rangeFrom: number,
  rangeTo: number,
): boolean {
  if (selectionFrom === selectionTo) {
    return selectionFrom >= rangeFrom && selectionFrom <= rangeTo;
  }
  return selectionFrom < rangeTo && selectionTo > rangeFrom;
}

function selectionMatchesRange(
  selectionFrom: number,
  selectionTo: number,
  rangeFrom: number,
  rangeTo: number,
): boolean {
  if (selectionFrom === selectionTo) {
    return selectionFrom >= rangeFrom && selectionFrom <= rangeTo;
  }
  return selectionFrom >= rangeFrom && selectionTo <= rangeTo;
}

export function findDocumentLabelReferenceAtSelection(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
  mode: "match" | "touch" = "touch",
): DocumentLabelReference | undefined {
  const predicate = mode === "match" ? selectionMatchesRange : selectionTouchesRange;
  return graph.references
    .filter((reference) => predicate(selectionFrom, selectionTo, reference.from, reference.to))
    .sort((left, right) =>
      ((left.to - left.from) - (right.to - right.from))
      || (left.from - right.from))
    [0];
}

export function findDocumentLabelDefinitionAtSelection(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
  range: "definition" | "label-token" = "definition",
): DocumentLabelDefinition | undefined {
  return graph.definitions
    .filter((definition) => {
      const from = range === "label-token" ? definition.tokenFrom : definition.from;
      const to = range === "label-token" ? definition.tokenTo : definition.to;
      const predicate = range === "label-token" ? selectionMatchesRange : selectionTouchesRange;
      return predicate(selectionFrom, selectionTo, from, to);
    })
    .sort((left, right) =>
      ((left.to - left.from) - (right.to - right.from))
      || (left.from - right.from))
    [0];
}

function duplicateTarget(
  graph: DocumentLabelGraph,
  id: string,
): DocumentLabelRenameTargetLookup {
  return {
    kind: "duplicate",
    id,
    definitions: graph.definitionsById.get(id) ?? [],
  };
}

function duplicateBacklinkTarget(
  graph: DocumentLabelGraph,
  id: string,
): DocumentLabelBacklinkTargetLookup {
  return {
    kind: "duplicate",
    id,
    definitions: graph.definitionsById.get(id) ?? [],
  };
}

function readyTarget(
  graph: DocumentLabelGraph,
  definition: DocumentLabelDefinition,
): DocumentLabelRenameTargetLookup {
  return {
    kind: "target",
    target: {
      definition,
      references: findDocumentLabelBacklinks(graph, definition.id),
    },
  };
}

export function resolveDocumentLabelRenameTargetInGraph(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo = selectionFrom,
): DocumentLabelRenameTargetLookup {
  const reference = findDocumentLabelReferenceAtSelection(
    graph,
    selectionFrom,
    selectionTo,
    "match",
  );
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return readyTarget(graph, definition);
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateBacklinkTarget(graph, reference.id);
    }
  }

  const definition = findDocumentLabelDefinitionAtSelection(
    graph,
    selectionFrom,
    selectionTo,
    "label-token",
  );
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateTarget(graph, definition.id);
    }
    return readyTarget(graph, definition);
  }

  return { kind: "none" };
}

export function resolveDocumentLabelBacklinkTargetInGraph(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo = selectionFrom,
): DocumentLabelBacklinkTargetLookup {
  const reference = findDocumentLabelReferenceAtSelection(
    graph,
    selectionFrom,
    selectionTo,
    "touch",
  );
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      const lookup = readyTarget(graph, definition);
      return lookup.kind === "target"
        ? { ...lookup, source: "reference" }
        : lookup;
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateBacklinkTarget(graph, reference.id);
    }
  }

  const definition = findDocumentLabelDefinitionAtSelection(
    graph,
    selectionFrom,
    selectionTo,
    "definition",
  );
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateBacklinkTarget(graph, definition.id);
    }
    const lookup = readyTarget(graph, definition);
    return lookup.kind === "target"
      ? { ...lookup, source: "definition" }
      : lookup;
  }

  return { kind: "none" };
}

export function resolveDocumentLabelSelectionTargetInGraph(
  graph: DocumentLabelGraph,
  selectedId: string,
): DocumentLabelBacklinkTargetLookup {
  const definition = graph.uniqueDefinitionById.get(selectedId);
  if (definition) {
    const lookup = readyTarget(graph, definition);
    return lookup.kind === "target"
      ? { ...lookup, source: "selection" }
      : lookup;
  }
  if (graph.duplicatesById.has(selectedId)) {
    return duplicateBacklinkTarget(graph, selectedId);
  }
  return { kind: "none" };
}

export function buildDocumentLabelRenameChanges(
  definition: DocumentLabelDefinition,
  references: readonly DocumentLabelReference[],
  nextId: string,
): readonly DocumentLabelChange[] {
  const spans = [
    { from: definition.labelFrom, to: definition.labelTo },
    ...references.map((reference) => ({
      from: reference.labelFrom,
      to: reference.labelTo,
    })),
  ];

  spans.sort((left, right) => (left.from - right.from) || (left.to - right.to));
  return spans.map((span) => ({ from: span.from, to: span.to, insert: nextId }));
}

export function prepareDocumentLabelRenameInGraph(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  nextId: string,
  selectionTo = selectionFrom,
): DocumentLabelRenamePlan {
  const lookup = resolveDocumentLabelRenameTargetInGraph(
    graph,
    selectionFrom,
    selectionTo,
  );
  if (lookup.kind !== "target") {
    return lookup;
  }

  const { definition, references } = lookup.target;
  const validation = validateDocumentLabelRename(graph, nextId, {
    currentId: definition.id,
  });

  if (!validation.ok) {
    return {
      kind: "invalid",
      definition,
      currentId: definition.id,
      referenceCount: references.length,
      validation,
    };
  }

  return {
    kind: "ready",
    definition,
    currentId: definition.id,
    nextId: validation.id,
    referenceCount: references.length,
    changes: validation.id === definition.id
      ? []
      : buildDocumentLabelRenameChanges(definition, references, validation.id),
  };
}
