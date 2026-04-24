import { type EditorState } from "@codemirror/state";
import {
  buildDocumentLabelGraph,
  findDocumentLabelBacklinks,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelReference,
} from "./document-label-graph";
import { documentLabelGraphField } from "../state/document-label-graph";
import {
  resolveDocumentLabelBacklinkTargetInGraph,
  resolveDocumentLabelSelectionTargetInGraph,
  type DocumentLabelBacklinkTargetLookup,
} from "../lib/markdown/label-model";

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

function getDocumentLabelGraph(state: EditorState): DocumentLabelGraph {
  return state.field(documentLabelGraphField, false) ?? buildDocumentLabelGraph(state);
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
  graph: DocumentLabelGraph,
  state: EditorState,
  definition: DocumentLabelDefinition,
  source: DocumentLabelBacklinksResult["source"],
): DocumentLabelBacklinksLookup {
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

function toBacklinksLookup(
  graph: DocumentLabelGraph,
  state: EditorState,
  lookup: DocumentLabelBacklinkTargetLookup,
): DocumentLabelBacklinksLookup {
  if (lookup.kind !== "target") {
    return lookup;
  }
  return readyResult(graph, state, lookup.target.definition, lookup.source);
}

export function resolveDocumentLabelBacklinks(
  state: EditorState,
): DocumentLabelBacklinksLookup {
  const graph = getDocumentLabelGraph(state);
  const selection = state.selection.main;

  const lookup = resolveDocumentLabelBacklinkTargetInGraph(
    graph,
    selection.from,
    selection.to,
  );
  if (lookup.kind !== "none") {
    return toBacklinksLookup(graph, state, lookup);
  }

  if (!selection.empty) {
    const id = state.sliceDoc(selection.from, selection.to).trim();
    return toBacklinksLookup(
      graph,
      state,
      resolveDocumentLabelSelectionTargetInGraph(graph, id),
    );
  }

  return { kind: "none" };
}
