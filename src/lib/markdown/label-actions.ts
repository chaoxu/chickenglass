import { getTextLineAtOffset } from "./text-lines";
import {
  buildDocumentLabelGraph,
  findDocumentLabelBacklinks,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelRenameValidation,
  validateDocumentLabelRename,
} from "./label-graph";
import type { DocumentLabelReference } from "./label-parser";

export interface DocumentLabelBacklinkItem {
  readonly from: number;
  readonly to: number;
  readonly lineNumber: number;
  readonly referenceText: string;
  readonly contextText: string;
  readonly locator?: string;
}

export interface DocumentLabelBacklinksResult {
  readonly definition: DocumentLabelDefinition;
  readonly backlinks: readonly DocumentLabelBacklinkItem[];
  readonly source: "definition" | "reference" | "selection";
}

export type DocumentLabelBacklinksLookup =
  | {
    readonly kind: "ready";
    readonly result: DocumentLabelBacklinksResult;
  }
  | {
    readonly kind: "duplicate";
    readonly id: string;
    readonly definitions: readonly DocumentLabelDefinition[];
  }
  | {
    readonly kind: "none";
  };

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

export type DocumentLabelRenamePlan =
  | {
    readonly kind: "ready";
    readonly definition: DocumentLabelDefinition;
    readonly currentId: string;
    readonly nextId: string;
    readonly referenceCount: number;
    readonly changes: ReadonlyArray<{ from: number; to: number; insert: string }>;
  }
  | {
    readonly kind: "invalid";
    readonly definition: DocumentLabelDefinition;
    readonly currentId: string;
    readonly referenceCount: number;
    readonly validation: DocumentLabelRenameValidation;
  }
  | DocumentLabelRenameTargetLookup;

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const headLength = Math.ceil((maxLength - 3) / 2);
  const tailLength = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, headLength)}...${text.slice(text.length - tailLength)}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeContext(text: string): string {
  return truncateMiddle(normalizeText(text), 140);
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

function findMatchingReference(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelReference | undefined {
  return graph.references
    .filter((reference) => selectionTouchesRange(selectionFrom, selectionTo, reference.from, reference.to))
    .sort((left, right) => ((left.to - left.from) - (right.to - right.from)) || (left.from - right.from))[0];
}

function findMatchingDefinition(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelDefinition | undefined {
  return graph.definitions
    .filter((definition) =>
      selectionTouchesRange(selectionFrom, selectionTo, definition.from, definition.to))
    .sort((left, right) => ((left.to - left.from) - (right.to - right.from)) || (left.from - right.from))[0];
}

function findRenameDefinition(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelDefinition | undefined {
  return graph.definitions
    .filter((definition) =>
      selectionMatchesRange(selectionFrom, selectionTo, definition.tokenFrom, definition.tokenTo))
    .sort((left, right) => ((left.to - left.from) - (right.to - right.from)) || (left.from - right.from))[0];
}

function buildBacklinkItem(
  doc: string,
  reference: DocumentLabelReference,
): DocumentLabelBacklinkItem {
  const line = getTextLineAtOffset(doc, reference.clusterFrom);
  return {
    from: reference.from,
    to: reference.to,
    lineNumber: line.number,
    referenceText: doc.slice(reference.from, reference.to),
    contextText: normalizeContext(line.text),
    locator: reference.locator,
  };
}

function readyBacklinksResult(
  doc: string,
  graph: DocumentLabelGraph,
  definition: DocumentLabelDefinition,
  source: DocumentLabelBacklinksResult["source"],
): DocumentLabelBacklinksLookup {
  return {
    kind: "ready",
    result: {
      definition,
      backlinks: findDocumentLabelBacklinks(graph, definition.id).map((reference) =>
        buildBacklinkItem(doc, reference)),
      source,
    },
  };
}

function duplicateLookup(
  graph: DocumentLabelGraph,
  id: string,
): {
  readonly kind: "duplicate";
  readonly id: string;
  readonly definitions: readonly DocumentLabelDefinition[];
} {
  return {
    kind: "duplicate",
    id,
    definitions: graph.definitionsById.get(id) ?? [],
  };
}

function buildRenameChanges(
  definition: DocumentLabelDefinition,
  references: readonly DocumentLabelReference[],
  nextId: string,
): ReadonlyArray<{ from: number; to: number; insert: string }> {
  const spans = [
    { from: definition.labelFrom, to: definition.labelTo },
    ...references.map((reference) => ({
      from: reference.labelFrom,
      to: reference.labelTo,
    })),
  ];

  spans.sort((left, right) => (left.from - right.from) || (left.to - right.to));
  return spans.map((span) => ({ ...span, insert: nextId }));
}

export function resolveDocumentLabelBacklinks(
  doc: string,
  selectionFrom: number,
  selectionTo = selectionFrom,
  graph = buildDocumentLabelGraph(doc),
): DocumentLabelBacklinksLookup {
  const reference = findMatchingReference(graph, selectionFrom, selectionTo);
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return readyBacklinksResult(doc, graph, definition, "reference");
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateLookup(graph, reference.id);
    }
  }

  const definition = findMatchingDefinition(graph, selectionFrom, selectionTo);
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateLookup(graph, definition.id);
    }
    return readyBacklinksResult(doc, graph, definition, "definition");
  }

  if (selectionFrom !== selectionTo) {
    const id = doc.slice(selectionFrom, selectionTo).trim();
    const selectedDefinition = graph.uniqueDefinitionById.get(id);
    if (selectedDefinition) {
      return readyBacklinksResult(doc, graph, selectedDefinition, "selection");
    }
    if (graph.duplicatesById.has(id)) {
      return duplicateLookup(graph, id);
    }
  }

  return { kind: "none" };
}

export function resolveDocumentLabelRenameTarget(
  doc: string,
  selectionFrom: number,
  selectionTo = selectionFrom,
  graph = buildDocumentLabelGraph(doc),
): DocumentLabelRenameTargetLookup {
  const reference = findMatchingReference(graph, selectionFrom, selectionTo);
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return {
        kind: "target",
        target: {
          definition,
          references: findDocumentLabelBacklinks(graph, definition.id),
        },
      };
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateLookup(graph, reference.id) as DocumentLabelRenameTargetLookup;
    }
  }

  const definition = findRenameDefinition(graph, selectionFrom, selectionTo);
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateLookup(graph, definition.id) as DocumentLabelRenameTargetLookup;
    }
    return {
      kind: "target",
      target: {
        definition,
        references: findDocumentLabelBacklinks(graph, definition.id),
      },
    };
  }

  return { kind: "none" };
}

export function prepareDocumentLabelRename(
  doc: string,
  selectionFrom: number,
  nextId: string,
  selectionTo = selectionFrom,
  graph = buildDocumentLabelGraph(doc),
): DocumentLabelRenamePlan {
  const lookup = resolveDocumentLabelRenameTarget(doc, selectionFrom, selectionTo, graph);
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
      : buildRenameChanges(definition, references, validation.id),
  };
}
