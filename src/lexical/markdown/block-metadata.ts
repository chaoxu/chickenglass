import {
  BLOCK_MANIFEST_ENTRIES,
  getBlockManifestEntry,
  getManifestBlockTitle,
  isKnownManifestBlockType,
} from "../../constants/block-manifest";
import type { FrontmatterConfig } from "../../lib/frontmatter";
export { normalizeBlockType } from "../../lib/markdown/block-types";

const BLOCK_LABELS = new Map<string, string>([
  ...BLOCK_MANIFEST_ENTRIES.map((entry) => [
    entry.name,
    getManifestBlockTitle(entry),
  ] as const),
]);

export function humanizeBlockType(blockType: string | undefined): string {
  if (!blockType) {
    return "Block";
  }
  return BLOCK_LABELS.get(blockType) ?? `${blockType.slice(0, 1).toUpperCase()}${blockType.slice(1)}`;
}

export function isKnownBlockType(blockType: string): boolean {
  return isKnownManifestBlockType(blockType);
}

export function resolveBlockTitle(blockType: string, config?: FrontmatterConfig): string {
  const override = config?.blocks?.[blockType];
  if (override && typeof override === "object" && typeof override.title === "string") {
    return override.title;
  }
  return humanizeBlockType(blockType);
}

export function resolveBlockNumbering(
  blockType: string,
  config?: FrontmatterConfig,
): { readonly counterGroup?: string; readonly numbered: boolean } {
  const manifestEntry = getBlockManifestEntry(blockType);
  const override = config?.blocks?.[blockType];
  const disabled = override === false;
  const overrideConfig = override && typeof override === "object" ? override : null;
  const numbered = disabled
    ? false
    : (overrideConfig?.numbered ?? manifestEntry?.numbered ?? true);
  if (!numbered) {
    return { numbered: false };
  }

  if (overrideConfig?.counter === null) {
    return { numbered: true };
  }

  return {
    counterGroup: config?.numbering === "global" ? "__global__" : blockType,
    numbered: true,
  };
}
