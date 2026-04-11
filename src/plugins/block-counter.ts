/**
 * Block numbering system.
 *
 * Walks the syntax tree to find FencedDiv nodes, checks which plugin
 * owns each one, and assigns sequential numbers per counter group.
 * Plugins sharing the same counter group (e.g., theorem and lemma)
 * increment a single shared counter.
 */

import { type ChangeDesc, type EditorState } from "@codemirror/state";
import type { NumberingScheme } from "../parser/frontmatter";
import type { FencedDivSemantics } from "../semantics/document";
import type { PluginRegistryState } from "./plugin-registry";
import { getPluginOrFallback } from "./plugin-registry";
import { documentSemanticsField } from "../state/document-analysis";

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
  /** Position-insensitive numbering signature for cheap equality checks. */
  readonly numberingKey: string;
}

/** Sentinel counter group used when numbering is "global". */
const GLOBAL_COUNTER = "_global";
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
function buildBlockCounterState(
  blocks: readonly NumberedBlock[],
  numberingKey: string,
): BlockCounterState {
  const byId = new Map<string, NumberedBlock>();
  const byPosition = new Map<number, NumberedBlock>();
  for (const block of blocks) {
    if (block.id) {
      byId.set(block.id, block);
    }
    byPosition.set(block.from, block);
  }
  return { blocks, byId, byPosition, numberingKey };
}

function buildNumberedBlocks(
  fencedDivs: readonly FencedDivSemantics[],
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): { readonly blocks: readonly NumberedBlock[]; readonly numberingKey: string } {
  const blocks: NumberedBlock[] = [];
  const counters = new Map<string, number>();
  const keyParts: string[] = [];

  for (const div of fencedDivs) {
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
    keyParts.push(`${entry.type}\0${entry.id ?? ""}\0${entry.number}`);
  }

  return {
    blocks,
    numberingKey: keyParts.join("\u0001"),
  };
}

function buildBlockNumberingKey(
  fencedDivs: readonly FencedDivSemantics[],
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): string {
  const counters = new Map<string, number>();
  const keyParts: string[] = [];

  for (const div of fencedDivs) {
    if (!div.primaryClass) continue;

    const plugin = getPluginOrFallback(registry, div.primaryClass);
    if (!plugin || !plugin.numbered) continue;

    const counterGroup =
      numbering === "global"
        ? GLOBAL_COUNTER
        : (plugin.counter ?? plugin.name);
    const current = (counters.get(counterGroup) ?? 0) + 1;
    counters.set(counterGroup, current);
    keyParts.push(`${div.primaryClass}\0${div.id ?? ""}\0${current}`);
  }

  return keyParts.join("\u0001");
}

export function computeBlockNumberingKeyFromFencedDivs(
  fencedDivs: readonly FencedDivSemantics[],
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): string {
  return buildBlockNumberingKey(fencedDivs, registry, numbering);
}

export function computeBlockNumbersFromFencedDivs(
  fencedDivs: readonly FencedDivSemantics[],
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): BlockCounterState {
  const { blocks, numberingKey } = buildNumberedBlocks(fencedDivs, registry, numbering);
  return buildBlockCounterState(blocks, numberingKey);
}

export function mapBlockCounterState(
  value: BlockCounterState,
  changes: ChangeDesc,
): BlockCounterState {
  let changed = false;
  const blocks = value.blocks.map((block) => {
    const from = changes.mapPos(block.from, 1);
    const to = Math.max(from, changes.mapPos(block.to, -1));
    if (from === block.from && to === block.to) {
      return block;
    }
    changed = true;
    return {
      ...block,
      from,
      to,
    };
  });

  return changed ? buildBlockCounterState(blocks, value.numberingKey) : value;
}

export function computeBlockNumbers(
  state: EditorState,
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): BlockCounterState {
  return computeBlockNumbersFromFencedDivs(
    state.field(documentSemanticsField).fencedDivs,
    registry,
    numbering,
  );
}

/** Create an empty counter state. */
export function emptyCounterState(): BlockCounterState {
  return { blocks: [], byId: new Map(), byPosition: new Map(), numberingKey: "" };
}
