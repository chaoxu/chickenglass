/**
 * Cross-reference resolver.
 *
 * Resolves [@id] and @id references to their targets: block labels
 * (e.g., "Theorem 1"), equation labels (e.g., "Eq. (3)"), citations
 * (deferred to the citation system), or unresolved references.
 *
 * Uses the block counter state and the syntax tree to find targets.
 */

import { type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { BlockCounterState } from "../plugins";
import { blockCounterField } from "../plugins";
import { pluginRegistryField, getPlugin } from "../plugins";
import { analyzeDocumentSemantics, type DocumentAnalysis } from "../semantics/document";
import { documentAnalysisField, editorStateTextSource } from "../semantics/codemirror-source";

/**
 * Return the cached document analysis from the CM6 field when available,
 * falling back to a full recompute from the syntax tree.
 */
function getAnalysisOrRecompute(state: EditorState): DocumentAnalysis {
  return (
    state.field(documentAnalysisField, false) ??
    analyzeDocumentSemantics(editorStateTextSource(state), syntaxTree(state))
  );
}

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
}

/** Equation label entry found in the syntax tree. */
export interface EquationEntry {
  /** The equation label id (e.g., "eq:foo"). */
  readonly id: string;
  /** The sequential equation number. */
  readonly number: number;
}

export function collectEquationLabels(
  state: EditorState,
): ReadonlyMap<string, EquationEntry> {
  const equations = getAnalysisOrRecompute(state).equationById;
  return new Map(
    [...equations.entries()].map(([id, equation]) => [
      id,
      { id, number: equation.number },
    ]),
  );
}

/**
 * Resolve a single reference id to its target.
 *
 * Resolution order:
 * 1. Check block labels (from blockCounterField)
 * 2. Check equation labels (from EquationLabel nodes)
 * 3. Assume it's a citation (to be resolved by the citation system)
 */
export function resolveCrossref(
  state: EditorState,
  id: string,
  equationLabels?: ReadonlyMap<string, EquationEntry>,
): ResolvedCrossref {
  // 1. Check block labels
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;

  if (counterState) {
    const block = counterState.byId.get(id);
    if (block) {
      const registry = state.field(pluginRegistryField, false);
      const plugin = registry ? getPlugin(registry, block.type) : undefined;
      const title = plugin?.title ?? block.type;
      return {
        kind: "block",
        label: `${title} ${block.number}`,
        number: block.number,
      };
    }
  }

  // 2. Check equation labels
  const eqLabels =
    equationLabels ??
    getAnalysisOrRecompute(state).equationById;
  const eqEntry = eqLabels.get(id);
  if (eqEntry) {
    return {
      kind: "equation",
      label: `Eq. (${eqEntry.number})`,
      number: eqEntry.number,
    };
  }

  // 3. Assume citation if not found as block or equation
  // Citations use identifiers that typically don't have prefixes like "eq:" or "thm-"
  // But we can't know for sure until the citation system is loaded,
  // so we mark it as citation (to be verified later by the citation renderer).
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
  const references = getAnalysisOrRecompute(state).references;

  return references
    .filter((ref) => ref.ids.length === 1)
    .map((ref) => ({
      id: ref.ids[0],
      from: ref.from,
      to: ref.to,
      bracketed: ref.bracketed,
    }));
}
