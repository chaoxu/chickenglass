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
import { readBracedLabelId } from "../parser/label-utils";

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
  const doc = state.doc.toString();
  const result = new Map<string, EquationEntry>();
  let counter = 0;

  tree.iterate({
    enter(node) {
      if (node.type.name !== "EquationLabel") return;
      const id = readBracedLabelId(
        doc,
        node.from,
        node.to,
        "eq:",
      );
      if (id) {
        counter++;
        result.set(id, { id, number: counter });
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

/** Pattern for bracketed cross-references: [@id] (single id, no semicolons). */
const BRACKETED_REF_RE = /^\[@([\w:.'-]+)\]$/;

/** Pattern for narrative @id references in plain text (not inside brackets). */
const NARRATIVE_REF_RE = /(?<!\w)@([\w:.'-]*\w)/g;

/**
 * Find all cross-reference patterns by walking the Lezer syntax tree.
 *
 * Bracketed references ([@id]) are found as Link nodes whose text
 * starts with `[@`. Narrative references (@id) are found by scanning
 * text content outside of Link nodes.
 */
export function findCrossrefs(state: EditorState): CrossrefMatch[] {
  const tree = syntaxTree(state);
  const doc = state.doc.toString();
  const matches: CrossrefMatch[] = [];

  // Set of ranges covered by Link nodes, used to avoid finding
  // narrative refs inside brackets
  const linkRanges: { from: number; to: number }[] = [];

  // 1. Walk the tree for Link nodes — bracketed refs like [@id]
  tree.iterate({
    enter(node) {
      if (node.name !== "Link") return;

      const text = doc.slice(node.from, node.to);
      const crossRefMatch = BRACKETED_REF_RE.exec(text);
      if (crossRefMatch) {
        matches.push({
          id: crossRefMatch[1],
          from: node.from,
          to: node.to,
          bracketed: true,
        });
      }

      linkRanges.push({ from: node.from, to: node.to });
    },
  });

  // 2. Scan full text for narrative @id refs, skipping Link ranges
  NARRATIVE_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NARRATIVE_REF_RE.exec(doc)) !== null) {
    const matchFrom = m.index;
    const matchTo = m.index + m[0].length;

    // Skip if inside a Link node
    const insideLink = linkRanges.some(
      (r) => matchFrom >= r.from && matchTo <= r.to,
    );
    if (insideLink) continue;

    matches.push({
      id: m[1],
      from: matchFrom,
      to: matchTo,
      bracketed: false,
    });
  }

  // Sort by document position
  matches.sort((a, b) => a.from - b.from);

  return matches;
}
