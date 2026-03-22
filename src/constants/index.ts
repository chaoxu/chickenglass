/**
 * Barrel file for centralized constants.
 *
 * Re-exports block manifest, CSS class names, and Lezer node types.
 */

export {
  BLOCK_MANIFEST,
  COUNTER_GROUPS,
  EMBED_CLASSES,
  EXCLUDED_FROM_FALLBACK,
  STYLED_BLOCK_NAMES,
  THEOREM_COUNTER,
  type BlockManifestEntry,
  type BlockName,
  type BodyStyle,
  type SpecialBehavior,
} from "./block-manifest";

export { CSS } from "./css-classes";

export { NODE, type NodeTypeName } from "./node-types";
