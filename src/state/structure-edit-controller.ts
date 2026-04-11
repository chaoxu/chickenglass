/**
 * Pure structure-edit controller. Owns transition logic for activating and
 * deactivating structure editing (entering/leaving a block's nested editor).
 *
 * This separates "what should happen" (pure) from "how to do it in Lexical/DOM"
 * (adapter code in plugins and renderers).
 */

import type {
  StructureBlockVariant,
  StructureEditState,
  StructureEditSurface,
} from "./structure-edit";
import {
  STRUCTURE_EDIT_IDLE,
  structureEditActive,
  isSameStructureEdit,
} from "./structure-edit";

/**
 * Intent to activate structure editing on a specific block.
 * Returns the new state if the transition is valid, or the same state if
 * the block is already being edited.
 */
export function activateStructureEdit(
  current: StructureEditState,
  blockKey: string,
  variant: StructureBlockVariant,
  surface: StructureEditSurface,
): StructureEditState {
  const next = structureEditActive(blockKey, variant, surface);
  if (isSameStructureEdit(current, next)) {
    return current;
  }
  return next;
}

/**
 * Intent to deactivate structure editing. Returns idle state.
 * If already idle, returns the same reference (no-op for change detection).
 */
export function deactivateStructureEdit(
  current: StructureEditState,
): StructureEditState {
  if (current.status === "idle") {
    return current;
  }
  return STRUCTURE_EDIT_IDLE;
}

/**
 * Intent to deactivate only if the currently-edited block matches the given
 * key. This is the typical pattern for onBlur handlers — only deactivate if
 * the thing losing focus is the thing we're tracking.
 */
export function deactivateStructureEditIfMatch(
  current: StructureEditState,
  blockKey: string,
  surface: StructureEditSurface,
): StructureEditState {
  if (
    current.status === "editing"
    && current.blockKey === blockKey
    && current.surface === surface
  ) {
    return STRUCTURE_EDIT_IDLE;
  }
  return current;
}
