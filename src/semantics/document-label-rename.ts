import type { ChangeSpec, EditorState } from "@codemirror/state";
import {
  buildDocumentLabelGraph,
  findDocumentLabelBacklinks,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelReference,
  type DocumentLabelRenameValidation,
  validateDocumentLabelRename,
} from "./document-label-graph";

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
    readonly changes: readonly ChangeSpec[];
  }
  | {
    readonly kind: "invalid";
    readonly definition: DocumentLabelDefinition;
    readonly currentId: string;
    readonly referenceCount: number;
    readonly validation: DocumentLabelRenameValidation;
  }
  | DocumentLabelRenameTargetLookup;

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
    .filter((reference) =>
      selectionMatchesRange(selectionFrom, selectionTo, reference.from, reference.to))
    .sort((left, right) =>
      ((left.to - left.from) - (right.to - right.from))
      || (left.from - right.from))
    [0];
}

function findMatchingDefinition(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelDefinition | undefined {
  return graph.definitions
    .filter((definition) =>
      selectionMatchesRange(selectionFrom, selectionTo, definition.tokenFrom, definition.tokenTo))
    .sort((left, right) =>
      ((left.to - left.from) - (right.to - right.from))
      || (left.from - right.from))
    [0];
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

function buildRenameChanges(
  definition: DocumentLabelDefinition,
  references: readonly DocumentLabelReference[],
  nextId: string,
): readonly ChangeSpec[] {
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

export function resolveDocumentLabelRenameTarget(
  state: EditorState,
): DocumentLabelRenameTargetLookup {
  const graph = buildDocumentLabelGraph(state);
  const selection = state.selection.main;

  const reference = findMatchingReference(graph, selection.from, selection.to);
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return readyTarget(graph, definition);
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateTarget(graph, reference.id);
    }
  }

  const definition = findMatchingDefinition(graph, selection.from, selection.to);
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateTarget(graph, definition.id);
    }
    return readyTarget(graph, definition);
  }

  return { kind: "none" };
}

export function prepareDocumentLabelRename(
  state: EditorState,
  nextId: string,
): DocumentLabelRenamePlan {
  const lookup = resolveDocumentLabelRenameTarget(state);
  if (lookup.kind !== "target") {
    return lookup;
  }

  const graph = buildDocumentLabelGraph(state);
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
