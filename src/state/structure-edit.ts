import type { NodeKey } from "lexical";

/**
 * Block variant identifier for structure-edit state. Matches the variants
 * defined in RawBlockNode but declared independently so that src/state/
 * does not import from src/lexical/ internals.
 */
export type StructureBlockVariant =
  | "display-math"
  | "fenced-div"
  | "footnote-definition"
  | "frontmatter"
  | "image"
  | "table";

export type StructureEditSurface =
  | "block-opener"
  | "display-math-source"
  | "footnote-source"
  | "frontmatter-source"
  | "table-cell";

/**
 * Describes which structure block is being actively edited and in what mode.
 *
 * "idle" — no structure block is being edited
 * "editing" — a specific block is in edit mode (table cell, math body, etc.)
 */
export type StructureEditState =
  | { readonly status: "idle" }
  | {
      readonly status: "editing";
      readonly blockKey: NodeKey;
      readonly surface: StructureEditSurface;
      readonly variant: StructureBlockVariant;
    };

export const STRUCTURE_EDIT_IDLE: StructureEditState = { status: "idle" };

export function structureEditActive(
  blockKey: NodeKey,
  variant: StructureBlockVariant,
  surface: StructureEditSurface,
): StructureEditState {
  return { status: "editing", blockKey, surface, variant };
}

export function isStructureEditActive(
  state: StructureEditState,
): state is Extract<StructureEditState, { status: "editing" }> {
  return state.status === "editing";
}

export function isSameStructureEdit(
  a: StructureEditState,
  b: StructureEditState,
): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "editing" && b.status === "editing") {
    return a.blockKey === b.blockKey
      && a.surface === b.surface
      && a.variant === b.variant;
  }
  return true;
}

export function isStructureEditMatch(
  state: StructureEditState,
  blockKey: NodeKey,
  variant: StructureBlockVariant,
  surface: StructureEditSurface,
): boolean {
  return state.status === "editing"
    && state.blockKey === blockKey
    && state.variant === variant
    && state.surface === surface;
}
