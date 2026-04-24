import type { ChangeDesc } from "@codemirror/state";
import {
  BLOCK_MANIFEST_BY_NAME,
  EXCLUDED_FROM_FALLBACK,
} from "../constants/block-manifest";
import type {
  BlockConfig,
  NumberingScheme,
} from "../parser/frontmatter";
import type { FencedDivSemantics } from "./document-model";

/** Minimal block metadata needed for semantic numbering. */
export interface BlockNumberingSpec {
  readonly name: string;
  readonly counter?: string;
  readonly numbered: boolean;
}

export type BlockNumberingSpecLookup = (
  blockType: string,
) => BlockNumberingSpec | undefined;

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

function counterGroupForSpec(
  spec: BlockNumberingSpec,
  numbering: NumberingScheme,
): string {
  return numbering === "global"
    ? GLOBAL_COUNTER
    : (spec.counter ?? spec.name);
}

function buildNumberedBlocks(
  fencedDivs: readonly FencedDivSemantics[],
  getSpec: BlockNumberingSpecLookup,
  numbering: NumberingScheme = "grouped",
): { readonly blocks: readonly NumberedBlock[]; readonly numberingKey: string } {
  const blocks: NumberedBlock[] = [];
  const counters = new Map<string, number>();
  const keyParts: string[] = [];

  for (const div of fencedDivs) {
    if (!div.primaryClass) continue;

    const spec = getSpec(div.primaryClass);
    if (!spec?.numbered) continue;

    const counterGroup = counterGroupForSpec(spec, numbering);
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
  getSpec: BlockNumberingSpecLookup,
  numbering: NumberingScheme = "grouped",
): string {
  const counters = new Map<string, number>();
  const keyParts: string[] = [];

  for (const div of fencedDivs) {
    if (!div.primaryClass) continue;

    const spec = getSpec(div.primaryClass);
    if (!spec?.numbered) continue;

    const counterGroup = counterGroupForSpec(spec, numbering);
    const current = (counters.get(counterGroup) ?? 0) + 1;
    counters.set(counterGroup, current);
    keyParts.push(`${div.primaryClass}\0${div.id ?? ""}\0${current}`);
  }

  return keyParts.join("\u0001");
}

export function computeBlockNumberingKey(
  fencedDivs: readonly FencedDivSemantics[],
  getSpec: BlockNumberingSpecLookup,
  numbering: NumberingScheme = "grouped",
): string {
  return buildBlockNumberingKey(fencedDivs, getSpec, numbering);
}

export function computeBlockNumbers(
  fencedDivs: readonly FencedDivSemantics[],
  getSpec: BlockNumberingSpecLookup,
  numbering: NumberingScheme = "grouped",
): BlockCounterState {
  const { blocks, numberingKey } = buildNumberedBlocks(fencedDivs, getSpec, numbering);
  return buildBlockCounterState(blocks, numberingKey);
}

function manifestSpec(blockType: string): BlockNumberingSpec | undefined {
  const entry = BLOCK_MANIFEST_BY_NAME.get(blockType);
  return entry
    ? {
        name: entry.name,
        counter: entry.counterGroup,
        numbered: entry.numbered,
      }
    : undefined;
}

function applyBlockConfig(
  name: string,
  config: BlockConfig,
  inherited: BlockNumberingSpec | undefined,
): BlockNumberingSpec {
  return {
    name,
    counter: config.counter === undefined
      ? inherited?.counter
      : config.counter ?? undefined,
    numbered: config.numbered ?? inherited?.numbered ?? true,
  };
}

export function createConfiguredBlockNumberingSpecLookup(
  blocksConfig: Readonly<Record<string, boolean | BlockConfig>> | undefined,
): BlockNumberingSpecLookup {
  const configured = new Map<string, BlockNumberingSpec>();
  const disabled = new Set<string>();

  if (blocksConfig) {
    for (const [name, value] of Object.entries(blocksConfig)) {
      if (value === true) continue;
      if (value === false) {
        disabled.add(name);
        configured.delete(name);
        continue;
      }
      disabled.delete(name);
      configured.set(name, applyBlockConfig(name, value, manifestSpec(name)));
    }
  }

  return (blockType) => {
    if (disabled.has(blockType)) return undefined;
    const configuredSpec = configured.get(blockType);
    if (configuredSpec) return configuredSpec;
    const builtIn = manifestSpec(blockType);
    if (builtIn) return builtIn;
    if (EXCLUDED_FROM_FALLBACK.has(blockType)) return undefined;
    return {
      name: blockType,
      numbered: true,
    };
  };
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

/** Create an empty counter state. */
export function emptyCounterState(): BlockCounterState {
  return { blocks: [], byId: new Map(), byPosition: new Map(), numberingKey: "" };
}
