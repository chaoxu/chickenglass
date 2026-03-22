/**
 * Block numbering system.
 *
 * Walks the syntax tree to find FencedDiv nodes, checks which plugin
 * owns each one, and assigns sequential numbers per counter group.
 * Plugins sharing the same counter group (e.g., theorem and lemma)
 * increment a single shared counter.
 */

import { type EditorState, StateField } from "@codemirror/state";
import type { NumberingScheme } from "../parser/frontmatter";
import type { PluginRegistryState } from "./plugin-registry";
import { getPluginOrFallback, pluginRegistryField } from "./plugin-registry";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentSemanticsField } from "../semantics/codemirror-source";

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

/**
 * Walk the syntax tree and assign numbers to all fenced divs
 * whose registered plugin is numbered.
 *
 * @param numbering - "global" shares one counter across all types,
 *   "grouped" (default) uses per-plugin counter groups.
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
    const numbering = state.field(frontmatterField).config.numbering;
    return computeBlockNumbers(state, state.field(pluginRegistryField), numbering);
  },

  update(value, tr) {
    if (
      tr.state.field(documentSemanticsField) !== tr.startState.field(documentSemanticsField)
    ) {
      const numbering = tr.state.field(frontmatterField).config.numbering;
      return computeBlockNumbers(tr.state, tr.state.field(pluginRegistryField), numbering);
    }
    return value;
  },
});
