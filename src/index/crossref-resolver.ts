import { type EditorState } from "@codemirror/state";
import {
  getEditorDocumentReferenceCatalog,
  getDocumentAnalysisOrRecompute,
} from "../semantics/editor-reference-catalog";
import { documentAnalysisField } from "../state/document-analysis";
import {
  formatEquationReferenceLabel,
  getPreferredDocumentReferenceTarget,
} from "../semantics/reference-catalog";

/** The kind of target a cross-reference resolves to. */
export type CrossrefKind = "block" | "equation" | "citation" | "unresolved";

/** Result of resolving a cross-reference. */
export interface ResolvedCrossref {
  /** What kind of target this reference points to. */
  readonly kind: CrossrefKind;
  /** The rendered display text (e.g., "Theorem 1", "Eq. (3)"). */
  readonly label: string;
  /** The assigned number, if applicable. */
  readonly number?: number;
  /** The full heading title, for heading cross-references. */
  readonly title?: string;
}

/** Equation label entry found in the syntax tree. */
export interface EquationEntry {
  /** The equation label id (e.g., "eq:foo"). */
  readonly id: string;
  /** The sequential equation number. */
  readonly number: number;
}

type ReferenceLookup = Pick<ReadonlyMap<string, unknown>, "has">;

export type ReferenceClassification =
  | { readonly kind: "crossref"; readonly resolved: ResolvedCrossref }
  | { readonly kind: "citation"; readonly id: string }
  | { readonly kind: "unresolved"; readonly id: string };

export interface ReferenceClassificationOptions {
  /** Known bibliography ids for citation routing. */
  readonly bibliography?: ReferenceLookup;
  /** Precomputed equation labels to avoid redundant analysis work. */
  readonly equationLabels?: ReadonlyMap<string, EquationEntry>;
  /**
   * Kept for callers that still distinguish bracketed refs. Local document
   * targets always take precedence over bibliography ids.
   */
  readonly preferCitation?: boolean;
}

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
  const target = getPreferredDocumentReferenceTarget(catalog, id);

  if (target?.kind === "block") {
    return {
      kind: "block",
      label: target.displayLabel,
      number: target.ordinal,
    };
  }

  const eqEntry = equationLabels?.get(id)
    ?? (target?.kind === "equation" && target.ordinal !== undefined
      ? { id, number: target.ordinal }
      : undefined);
  if (eqEntry) {
    return {
      kind: "equation",
      label: formatEquationReferenceLabel(eqEntry.number),
      number: eqEntry.number,
    };
  }

  if (target?.kind === "heading") {
    return {
      kind: "block",
      label: target.displayLabel,
      title: target.title,
    };
  }

  // Assume citation if not found as block, equation, or heading.
  return {
    kind: "citation",
    label: id,
  };
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
  const {
    bibliography,
    equationLabels,
  } = options;
  const hasCitation = bibliography?.has(id) ?? false;

  const resolved = resolveCrossref(state, id, equationLabels);
  if (resolved.kind === "block" || resolved.kind === "equation") {
    return { kind: "crossref", resolved };
  }

  if (hasCitation) {
    return { kind: "citation", id };
  }

  return { kind: "unresolved", id };
}
