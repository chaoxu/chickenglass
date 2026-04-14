/**
 * raw-block-types — leaf module for the RawBlockVariant union.
 *
 * Imported by both `raw-block-node.ts` and `raw-block-renderer-registry.ts`
 * so neither needs to back-edge through the renderer layer.
 */
export type RawBlockVariant =
  | "display-math"
  | "fenced-div"
  | "footnote-definition"
  | "frontmatter"
  | "image";
