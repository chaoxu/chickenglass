import {
  getBlockPresentationKind,
  type BlockPresentationKind,
} from "../../constants/block-manifest";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import type { ParsedFencedDivBlock } from "./block-syntax";
import { resolveBlockTitle } from "./block-metadata";

export type FencedDivPresentationKind = BlockPresentationKind;

export interface FencedDivViewModel {
  readonly blockType: string;
  readonly kind: FencedDivPresentationKind;
  readonly label: string;
  readonly parsed: ParsedFencedDivBlock;
}

export const getFencedDivPresentationKind = getBlockPresentationKind;

export function createFencedDivViewModel(
  parsed: ParsedFencedDivBlock,
  options: {
    readonly config?: FrontmatterConfig;
    readonly referenceLabel?: string;
  } = {},
): FencedDivViewModel {
  return {
    blockType: parsed.blockType,
    kind: getFencedDivPresentationKind(parsed.blockType),
    label: options.referenceLabel ?? resolveBlockTitle(parsed.blockType, options.config),
    parsed,
  };
}
