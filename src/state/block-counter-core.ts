import { type EditorState } from "@codemirror/state";
import type { NumberingScheme } from "../parser/frontmatter";
import type { FencedDivSemantics } from "../semantics/document";
import {
  computeBlockNumberingKey,
  computeBlockNumbers as computeSemanticBlockNumbers,
  emptyCounterState,
  mapBlockCounterState,
  type BlockCounterState,
  type NumberedBlock,
} from "../semantics/block-numbering";
import type { PluginRegistryState } from "./plugin-registry-core";
import { getPluginOrFallback } from "./plugin-registry-core";
import { documentSemanticsField } from "./document-analysis";

function getBlockNumberingSpec(
  registry: PluginRegistryState,
  blockType: string,
) {
  return getPluginOrFallback(registry, blockType);
}

export function computeBlockNumberingKeyFromFencedDivs(
  fencedDivs: readonly FencedDivSemantics[],
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): string {
  return computeBlockNumberingKey(
    fencedDivs,
    (blockType) => getBlockNumberingSpec(registry, blockType),
    numbering,
  );
}

export function computeBlockNumbersFromFencedDivs(
  fencedDivs: readonly FencedDivSemantics[],
  registry: PluginRegistryState,
  numbering: NumberingScheme = "grouped",
): BlockCounterState {
  return computeSemanticBlockNumbers(
    fencedDivs,
    (blockType) => getBlockNumberingSpec(registry, blockType),
    numbering,
  );
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

export {
  emptyCounterState,
  mapBlockCounterState,
  type BlockCounterState,
  type NumberedBlock,
};
