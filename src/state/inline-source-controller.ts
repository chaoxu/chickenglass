/**
 * Pure inline-source controller. Owns transition logic for entering and
 * exiting inline format source editing mode.
 *
 * The actual Lexical tree mutations and DOM selection sync stay in the
 * plugin (inline-format-source-plugin.tsx). This module owns the decision
 * logic: "should we activate/deactivate?" and "what state results?"
 */

import type { InlineSourceEntrySide, InlineSourceState } from "./inline-source";
import { INLINE_SOURCE_INACTIVE, inlineSourceActive } from "./inline-source";

/**
 * Intent to activate inline source editing on a node. Returns the new
 * state if the transition is valid. If the same node is already active with
 * the same entry side, returns the same reference (no-op).
 */
export function activateInlineSource(
  current: InlineSourceState,
  nodeKey: string,
  entrySide: InlineSourceEntrySide,
): InlineSourceState {
  if (
    current.status === "active"
    && current.nodeKey === nodeKey
    && current.entrySide === entrySide
  ) {
    return current;
  }
  return inlineSourceActive(nodeKey, entrySide);
}

/**
 * Intent to deactivate inline source editing. Returns inactive state.
 * If already inactive, returns the same reference (no-op).
 */
export function deactivateInlineSource(
  current: InlineSourceState,
): InlineSourceState {
  if (current.status === "inactive") {
    return current;
  }
  return INLINE_SOURCE_INACTIVE;
}

/**
 * Intent to deactivate only if the currently-edited node matches the
 * given key. Typical for blur handlers or when a specific node is removed.
 */
export function deactivateInlineSourceIfMatch(
  current: InlineSourceState,
  nodeKey: string,
): InlineSourceState {
  if (current.status === "active" && current.nodeKey === nodeKey) {
    return INLINE_SOURCE_INACTIVE;
  }
  return current;
}

/**
 * Check whether the given node key is the currently-active inline source.
 */
export function isActiveInlineSource(
  state: InlineSourceState,
  nodeKey: string,
): boolean {
  return state.status === "active" && state.nodeKey === nodeKey;
}
