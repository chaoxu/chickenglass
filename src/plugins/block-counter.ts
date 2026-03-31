/**
 * Block numbering system.
 *
 * Walks the syntax tree to find FencedDiv nodes, checks which plugin
 * owns each one, and assigns sequential numbers per counter group.
 * Plugins sharing the same counter group (e.g., theorem and lemma)
 * increment a single shared counter.
 */

import { type EditorState, StateField, type Transaction } from "@codemirror/state";
import type { NumberingScheme } from "../parser/frontmatter";
import type { PluginRegistryState } from "./plugin-registry";
import { getPluginOrFallback, pluginRegistryField } from "./plugin-registry";
import { frontmatterField } from "../editor/frontmatter-state";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";

/** A numbered block entry mapping a fenced div to its assigned number. */
export interface NumberedBlock {
  /** Start position of the FencedDiv node in the document. */
  readonly from: number;
  /** End position of the FencedDiv node in the document. */
  readonly to: number;
  /** The plugin class name (e.g. "theorem"). */
  readonly type: string;
  /** The id from attributes, if any. */
  readonly id?: string;
  /** The assigned number. */
  readonly number: number;
}

/** Immutable counter state for the entire document. */
export interface BlockCounterState {
  /** Ordered list of all numbered blocks in the document. */
  readonly blocks: readonly NumberedBlock[];
  /** Map from block id to its NumberedBlock entry. */
  readonly byId: ReadonlyMap<string, NumberedBlock>;
  /** Map from document position (from) to its NumberedBlock entry. */
  readonly byPosition: ReadonlyMap<number, NumberedBlock>;
}

/** Sentinel counter group used when numbering is "global". */
const GLOBAL_COUNTER = "_global";

function getEffectiveNumbering(state: EditorState): NumberingScheme {
  return state.field(frontmatterField).config.numbering ?? "grouped";
}

function shouldRecomputeBlockNumbers(tr: Transaction): boolean {
  // Check fencedDivs first — revision can change from async tree updates
  // (Lezer parse completion), not just doc edits. Without this, block
  // numbers go stale when the parser discovers new fenced divs after the
  // initial partial parse (#752).
  const startSemantics = tr.startState.field(documentSemanticsField);
  const nextSemantics = tr.state.field(documentSemanticsField);
  if (
    getDocumentAnalysisSliceRevision(startSemantics, "fencedDivs")
    !== getDocumentAnalysisSliceRevision(nextSemantics, "fencedDivs")
  ) {
    return true;
  }

  if (!tr.docChanged && !tr.reconfigured) {
    return false;
  }

  if (tr.startState.field(pluginRegistryField) !== tr.state.field(pluginRegistryField)) {
    return true;
  }

  return getEffectiveNumbering(tr.startState) !== getEffectiveNumbering(tr.state);
}

/**
 * Walk the semantic fenced-div list and assign sequential numbers to all
 * blocks whose registered plugin has `numbered: true`.
 *
 * Algorithm (O(n) in number of fenced divs):
 * Iterates `documentSemanticsField.fencedDivs` in document order. For each
 * div that has a `primaryClass` and a matching numbered plugin, it increments
 * the appropriate counter and records a `NumberedBlock` entry.
 *
 * Counter groups:
 * - **"grouped"** (default / academic style): each plugin contributes to
 *   its own counter, identified by `plugin.counter ?? plugin.name`. Plugins
 *   can share a counter group by setting the same `counter` value (e.g.
 *   `theorem` and `lemma` both set `counter: "theorem"` to share "Theorem 1,
 *   Lemma 2, Theorem 3, …" style numbering).
 * - **"global"** (blog style): all numbered blocks share one counter
 *   regardless of type, keyed by the `GLOBAL_COUNTER` sentinel `"_global"`.
 *   Produces "Block 1, Block 2, …" across all plugin types.
 *
 * Output maps (`byId`, `byPosition`) are built in the same pass for O(1)
 * lookup by callers that need to resolve `[@id]` cross-references or find
 * the block at a given cursor position.
 *
 * @param numbering - Numbering scheme from frontmatter (`"global"` or
 *   `"grouped"`). Defaults to `"grouped"`.
 */
export function computeBlockNumbers(
  state: EditorState,
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): BlockCounterState {
  const blocks: NumberedBlock[] = [];
  const byId = new Map<string, NumberedBlock>();
  const byPosition = new Map<number, NumberedBlock>();
  const counters = new Map<string, number>();

  for (const div of state.field(documentSemanticsField).fencedDivs) {
    if (!div.primaryClass) continue;

    const plugin = getPluginOrFallback(registry, div.primaryClass);
    if (!plugin || !plugin.numbered) continue;

    const counterGroup =
      numbering === "global"
        ? GLOBAL_COUNTER
        : (plugin.counter ?? plugin.name);
    const current = (counters.get(counterGroup) ?? 0) + 1;
    counters.set(counterGroup, current);

    const entry: NumberedBlock = {
      from: div.from,
      to: div.to,
      type: div.primaryClass,
      id: div.id,
      number: current,
    };

    blocks.push(entry);
    if (div.id) {
      byId.set(div.id, entry);
    }
    byPosition.set(div.from, entry);
  }

  return { blocks, byId, byPosition };
}

/** Create an empty counter state. */
export function emptyCounterState(): BlockCounterState {
  return { blocks: [], byId: new Map(), byPosition: new Map() };
}

/**
 * CM6 StateField that maintains block numbering.
 *
 * Depends on the pluginRegistryField to know which plugins are
 * registered and which counter groups they use.
 *
 * Usage:
 * ```ts
 * const counters = state.field(blockCounterField);
 * const entry = counters.byId.get("thm-1");
 * ```
 */
export const blockCounterField = StateField.define<BlockCounterState>({
  create(state) {
    return computeBlockNumbers(
      state,
      state.field(pluginRegistryField),
      getEffectiveNumbering(state),
    );
  },

  update(value, tr) {
    if (shouldRecomputeBlockNumbers(tr)) {
      return computeBlockNumbers(
        tr.state,
        tr.state.field(pluginRegistryField),
        getEffectiveNumbering(tr.state),
      );
    }
    return value;
  },

  compare(a, b) {
    if (a.blocks.length !== b.blocks.length) return false;
    for (let i = 0; i < a.blocks.length; i++) {
      const ba = a.blocks[i];
      const bb = b.blocks[i];
      if (
        ba.from !== bb.from || ba.to !== bb.to ||
        ba.type !== bb.type || ba.id !== bb.id ||
        ba.number !== bb.number
      ) return false;
    }
    return true;
  },
});
