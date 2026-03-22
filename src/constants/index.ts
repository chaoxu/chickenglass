/**
 * Barrel file for centralized constants.
 *
 * Re-exports block manifest, CSS class names, and Lezer node types.
 */

export {
  ALGORITHM_COUNTER,
  BLOCK_MANIFEST,
  COUNTER_GROUPS,
  DEFINITION_COUNTER,
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
