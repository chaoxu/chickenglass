/**
 * Cross-reference resolver.
 *
 * Resolves [@id] and @id references to their targets: block labels
 * (e.g., "Theorem 1"), equation labels (e.g., "Eq. (3)"), citations
 * (deferred to the citation system), or unresolved references.
 *
 * Uses the block counter state and the syntax tree to find targets.
 */

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { BlockCounterState } from "../plugins/block-counter";
import { blockCounterField } from "../plugins/block-counter";
import { pluginRegistryField, getPlugin } from "../plugins/plugin-registry";

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

/**
 * Scan the syntax tree for EquationLabel nodes and assign sequential numbers.
 * Returns a map from equation id to its entry.
 */
export function collectEquationLabels(
  state: EditorState,
): ReadonlyMap<string, EquationEntry> {
  const tree = syntaxTree(state);
  const result = new Map<string, EquationEntry>();
  let counter = 0;

  tree.iterate({
    enter(node) {
      if (node.type.name !== "EquationLabel") return;

      const text = state.doc.sliceString(node.from, node.to);
      // EquationLabel text is like {#eq:foo}
      const match = /^\{#(eq:[^}\s]+)\}$/.exec(text);
      if (match) {
        counter++;
        result.set(match[1], { id: match[1], number: counter });
      }
    },
  });

  return result;
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
  const eqLabels = equationLabels ?? collectEquationLabels(state);
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

/**
 * Regex to find cross-reference patterns in document text.
 *
 * Matches:
 * - [@id] — parenthetical reference (inside brackets)
 * - @id — narrative reference (bare, must end with a word character)
 *
 * The id can contain: letters, digits, hyphens, underscores, colons, periods.
 * For narrative @id, the id must end with a word character to avoid
 * matching trailing punctuation (e.g., "@thm-1." should match "@thm-1").
 */
export const CROSSREF_PATTERN = /\[@([\w:.'-]+)\]|(?<!\w)@([\w:.'-]*\w)/g;

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

/**
 * Find all cross-reference patterns in the document text.
 * Scans the full document for [@id] and @id patterns.
 */
export function findCrossrefs(state: EditorState): CrossrefMatch[] {
  const text = state.doc.toString();
  const matches: CrossrefMatch[] = [];
  const re = new RegExp(CROSSREF_PATTERN.source, CROSSREF_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const id = match[1] ?? match[2];
    matches.push({
      id,
      from: match.index,
      to: match.index + match[0].length,
      bracketed: match[1] !== undefined,
    });
  }

  return matches;
}
