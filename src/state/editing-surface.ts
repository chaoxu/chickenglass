import type { FocusOwner } from "./editor-focus";
import type { InlineSourceState } from "./inline-source";
import type { StructureEditState } from "./structure-edit";
import { FOCUS_NONE, isSameFocusOwner } from "./editor-focus";
import { INLINE_SOURCE_INACTIVE } from "./inline-source";
import { isSameStructureEdit, STRUCTURE_EDIT_IDLE } from "./structure-edit";

/**
 * Composition module: bundles the three editing-surface state slices that
 * multiple subsystems need to coordinate around.
 *
 * This is the coflat2 equivalent of coflat v1's reference-render-state.ts
 * pattern — a single read point for state that was previously scattered
 * across the hidden bridge, nested surfaces, and individual plugins.
 *
 * Consumers import this module instead of reaching into three separate owners.
 */
export interface EditingSurfaceState {
  readonly focus: FocusOwner;
  readonly structureEdit: StructureEditState;
  readonly inlineSource: InlineSourceState;
}

export const EDITING_SURFACE_IDLE: EditingSurfaceState = {
  focus: FOCUS_NONE,
  structureEdit: STRUCTURE_EDIT_IDLE,
  inlineSource: INLINE_SOURCE_INACTIVE,
};

export function isEditingSurfaceChanged(
  prev: EditingSurfaceState,
  next: EditingSurfaceState,
): boolean {
  return (
    !isSameFocusOwner(prev.focus, next.focus)
    || !isSameStructureEdit(prev.structureEdit, next.structureEdit)
    || prev.inlineSource !== next.inlineSource
  );
}
