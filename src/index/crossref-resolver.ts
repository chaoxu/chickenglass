import { type EditorState } from "@codemirror/state";
import {
  getEditorDocumentReferenceCatalog,
  getDocumentAnalysisOrRecompute,
} from "../semantics/editor-reference-catalog";
import { documentAnalysisField } from "../state/document-analysis";
import {
  classifyReferenceTarget,
  type EquationEntry,
  resolveCatalogCrossref,
  type ReferenceClassification,
  type ReferenceClassificationOptions,
  type ResolvedCrossref,
} from "../references/presentation";

export type {
  CrossrefKind,
  EquationEntry,
  ReferenceClassification,
  ReferenceClassificationOptions,
  ResolvedCrossref,
} from "../references/presentation";

export function collectEquationLabels(
  state: EditorState,
): ReadonlyMap<string, EquationEntry> {
  const catalog = getEditorDocumentReferenceCatalog(state);
  const equations = new Map<string, EquationEntry>();
  for (const target of catalog.targets) {
    if (target.kind !== "equation" || !target.id || target.ordinal === undefined) {
      continue;
    }
    equations.set(target.id, {
      id: target.id,
      number: target.ordinal,
    });
  }
  return equations;
}

/**
 * Resolve a single reference id to its target.
 *
 * Resolution order:
 * 1. Check block labels (from blockCounterField)
 * 2. Check equation labels (from EquationLabel nodes)
 * 3. Check heading labels
 * 4. Assume it's a citation (to be resolved by the citation system)
 */
export function resolveCrossref(
  state: EditorState,
  id: string,
  equationLabels?: ReadonlyMap<string, EquationEntry>,
): ResolvedCrossref {
  const catalog = getEditorDocumentReferenceCatalog(state);
  return resolveCatalogCrossref(catalog, id, equationLabels)
    ?? { kind: "citation", label: id };
}

/** A cross-reference occurrence found in the document text. */
export interface CrossrefMatch {
  /** The reference id (without @ or brackets). */
  readonly id: string;
  /** Start position in the document. */
  readonly from: number;
  /** End position in the document. */
  readonly to: number;
  /** Whether this is a bracketed reference [@id] vs narrative @id. */
  readonly bracketed: boolean;
}

export function findCrossrefs(state: EditorState): CrossrefMatch[] {
  const references = (
    state.field(documentAnalysisField, false)
    ?? getDocumentAnalysisOrRecompute(state)
  ).references;

  return references
    .filter((ref) => ref.ids.length === 1)
    .map((ref) => ({
      id: ref.ids[0],
      from: ref.from,
      to: ref.to,
      bracketed: ref.bracketed,
    }));
}

export function classifyReference(
  state: EditorState,
  id: string,
  options: ReferenceClassificationOptions = {},
): ReferenceClassification {
  const catalog = getEditorDocumentReferenceCatalog(state);
  return classifyReferenceTarget(
    (targetId) => resolveCatalogCrossref(catalog, targetId, options.equationLabels),
    id,
    { bibliography: options.bibliography },
  );
}
