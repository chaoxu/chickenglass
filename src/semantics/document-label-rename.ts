import type { ChangeSpec, EditorState } from "@codemirror/state";
import {
  buildDocumentLabelGraph,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
  type DocumentLabelReference,
  type DocumentLabelRenameValidation,
} from "./document-label-graph";
import { documentLabelGraphField } from "../state/document-label-graph";
import {
  prepareDocumentLabelRenameInGraph,
  resolveDocumentLabelRenameTargetInGraph,
  type DocumentLabelRenamePlan as SharedDocumentLabelRenamePlan,
  type DocumentLabelRenameTargetLookup,
} from "../lib/markdown/label-model";

export interface DocumentLabelRenameTarget {
  readonly definition: DocumentLabelDefinition;
  readonly references: readonly DocumentLabelReference[];
}

export type { DocumentLabelRenameTargetLookup };

export type DocumentLabelRenamePlan =
  | (Omit<Extract<SharedDocumentLabelRenamePlan, { readonly kind: "ready" }>, "changes"> & {
    readonly changes: readonly ChangeSpec[];
  })
  | Extract<SharedDocumentLabelRenamePlan, { readonly kind: "invalid" }>
  | DocumentLabelRenameTargetLookup;

function getDocumentLabelGraph(state: EditorState): DocumentLabelGraph {
  return state.field(documentLabelGraphField, false) ?? buildDocumentLabelGraph(state);
}

export function resolveDocumentLabelRenameTarget(
  state: EditorState,
): DocumentLabelRenameTargetLookup {
  const selection = state.selection.main;
  return resolveDocumentLabelRenameTargetInGraph(
    getDocumentLabelGraph(state),
    selection.from,
    selection.to,
  );
}

export function prepareDocumentLabelRename(
  state: EditorState,
  nextId: string,
): DocumentLabelRenamePlan {
  const selection = state.selection.main;
  return prepareDocumentLabelRenameInGraph(
    getDocumentLabelGraph(state),
    selection.from,
    nextId,
    selection.to,
  ) as DocumentLabelRenamePlan;
}

export type { DocumentLabelRenameValidation };
