import { type EditorState } from "@codemirror/state";
import {
  buildDocumentLabelGraph,
  findDocumentLabelBacklinks,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelReference,
} from "./document-label-graph";

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

function findMatchingReference(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelReference | undefined {
  return graph.references
    .filter((reference) =>
      selectionTouchesRange(selectionFrom, selectionTo, reference.from, reference.to))
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
      selectionTouchesRange(selectionFrom, selectionTo, definition.from, definition.to))
    .sort((left, right) =>
      ((left.to - left.from) - (right.to - right.from))
      || (left.from - right.from))
    [0];
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const headLength = Math.ceil((maxLength - 3) / 2);
  const tailLength = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, headLength)}...${text.slice(text.length - tailLength)}`;
}

function normalizeContext(text: string): string {
  return truncateMiddle(text.replace(/\s+/g, " ").trim(), 140);
}

function buildBacklinkItem(
  state: EditorState,
  reference: DocumentLabelReference,
): DocumentLabelBacklinkItem {
  const line = state.doc.lineAt(reference.clusterFrom);
  return {
    from: reference.from,
    to: reference.to,
    lineNumber: line.number,
    referenceText: state.doc.sliceString(reference.from, reference.to),
    contextText: normalizeContext(line.text),
    locator: reference.locator,
  };
}

function readyResult(
  state: EditorState,
  definition: DocumentLabelDefinition,
  source: DocumentLabelBacklinksResult["source"],
): DocumentLabelBacklinksLookup {
  const graph = buildDocumentLabelGraph(state);
  return {
    kind: "ready",
    result: {
      definition,
      backlinks: findDocumentLabelBacklinks(graph, definition.id)
        .map((reference) => buildBacklinkItem(state, reference)),
      source,
    },
  };
}

function duplicateResult(
  graph: DocumentLabelGraph,
  id: string,
): DocumentLabelBacklinksLookup {
  return {
    kind: "duplicate",
    id,
    definitions: graph.definitionsById.get(id) ?? [],
  };
}

export function resolveDocumentLabelBacklinks(
  state: EditorState,
): DocumentLabelBacklinksLookup {
  const graph = buildDocumentLabelGraph(state);
  const selection = state.selection.main;

  const reference = findMatchingReference(graph, selection.from, selection.to);
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return readyResult(state, definition, "reference");
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateResult(graph, reference.id);
    }
  }

  const definition = findMatchingDefinition(graph, selection.from, selection.to);
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateResult(graph, definition.id);
    }
    return readyResult(state, definition, "definition");
  }

  if (!selection.empty) {
    const id = state.sliceDoc(selection.from, selection.to).trim();
    const selectedDefinition = graph.uniqueDefinitionById.get(id);
    if (selectedDefinition) {
      return readyResult(state, selectedDefinition, "selection");
    }
    if (graph.duplicatesById.has(id)) {
      return duplicateResult(graph, id);
    }
  }

  return { kind: "none" };
}
