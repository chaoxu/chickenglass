import type { NodeKey } from "lexical";

/**
 * Discriminated union representing which editing surface currently holds focus.
 *
 * "rich-surface" — the main Lexical rich-text editor root
 * "source-bridge" — the hidden plain-text source bridge
 * "source-surface" — the visible source-mode plain-text editor
 * "structure-edit" — a nested editor inside a decorator block (table cell, math, etc.)
 * "none" — no coflat editor surface is focused
 */
export type FocusOwner =
  | { readonly kind: "rich-surface" }
  | { readonly kind: "source-bridge" }
  | { readonly kind: "source-surface" }
  | { readonly kind: "structure-edit"; readonly blockKey: NodeKey }
  | { readonly kind: "none" };

export const FOCUS_NONE: FocusOwner = { kind: "none" };
export const FOCUS_RICH_SURFACE: FocusOwner = { kind: "rich-surface" };
export const FOCUS_SOURCE_BRIDGE: FocusOwner = { kind: "source-bridge" };
export const FOCUS_SOURCE_SURFACE: FocusOwner = { kind: "source-surface" };

export function focusStructureEdit(blockKey: NodeKey): FocusOwner {
  return { kind: "structure-edit", blockKey };
}

export function isSameFocusOwner(a: FocusOwner, b: FocusOwner): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "structure-edit" && b.kind === "structure-edit") {
    return a.blockKey === b.blockKey;
  }
  return true;
}
