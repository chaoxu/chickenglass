import type { FrontmatterConfig } from "../../lib/frontmatter";
import type { ParsedFencedDivBlock } from "./block-syntax";
import { resolveBlockTitle } from "./block-metadata";

export type FencedDivPresentationKind =
  | "blockquote"
  | "captioned"
  | "embed"
  | "include"
  | "standard";

export interface FencedDivViewModel {
  readonly blockType: string;
  readonly kind: FencedDivPresentationKind;
  readonly label: string;
  readonly parsed: ParsedFencedDivBlock;
}

const EMBED_BLOCK_TYPES = new Set(["embed", "gist", "iframe", "youtube"]);
const CAPTIONED_BLOCK_TYPES = new Set(["figure", "table"]);

export function getFencedDivPresentationKind(blockType: string): FencedDivPresentationKind {
  if (blockType === "include") {
    return "include";
  }
  if (EMBED_BLOCK_TYPES.has(blockType)) {
    return "embed";
  }
  if (blockType === "blockquote") {
    return "blockquote";
  }
  if (CAPTIONED_BLOCK_TYPES.has(blockType)) {
    return "captioned";
  }
  return "standard";
}

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
