import { getTextLineAtOffset } from "./text-lines";
import {
  buildDocumentLabelGraph,
  findDocumentLabelBacklinks,
  prepareDocumentLabelRenameInGraph,
  type DocumentLabelBacklinkTargetLookup,
  resolveDocumentLabelBacklinkTargetInGraph,
  resolveDocumentLabelRenameTargetInGraph,
  resolveDocumentLabelSelectionTargetInGraph,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelRenamePlan,
  type DocumentLabelRenameTarget,
  type DocumentLabelRenameTargetLookup,
} from "./label-graph";
import type { DocumentLabelReference } from "./label-parser";

export type {
  DocumentLabelRenamePlan,
  DocumentLabelRenameTarget,
  DocumentLabelRenameTargetLookup,
};

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

function targetToBacklinksLookup(
  doc: string,
  graph: DocumentLabelGraph,
  lookup: DocumentLabelBacklinkTargetLookup,
): DocumentLabelBacklinksLookup {
  if (lookup.kind !== "target") {
    return lookup;
  }
  return readyBacklinksResult(doc, graph, lookup.target.definition, lookup.source);
}

export function resolveDocumentLabelBacklinks(
  doc: string,
  selectionFrom: number,
  selectionTo = selectionFrom,
  graph = buildDocumentLabelGraph(doc),
): DocumentLabelBacklinksLookup {
  const lookup = resolveDocumentLabelBacklinkTargetInGraph(graph, selectionFrom, selectionTo);
  if (lookup.kind !== "none") {
    return targetToBacklinksLookup(doc, graph, lookup);
  }

  if (selectionFrom !== selectionTo) {
    const id = doc.slice(selectionFrom, selectionTo).trim();
    const selectedLookup = resolveDocumentLabelSelectionTargetInGraph(graph, id);
    return targetToBacklinksLookup(doc, graph, selectedLookup);
  }

  return { kind: "none" };
}

export function resolveDocumentLabelRenameTarget(
  doc: string,
  selectionFrom: number,
  selectionTo = selectionFrom,
  graph = buildDocumentLabelGraph(doc),
): DocumentLabelRenameTargetLookup {
  return resolveDocumentLabelRenameTargetInGraph(graph, selectionFrom, selectionTo);
}

export function prepareDocumentLabelRename(
  doc: string,
  selectionFrom: number,
  nextId: string,
  selectionTo = selectionFrom,
  graph = buildDocumentLabelGraph(doc),
): DocumentLabelRenamePlan {
  return prepareDocumentLabelRenameInGraph(
    graph,
    selectionFrom,
    nextId,
    selectionTo,
  );
}
