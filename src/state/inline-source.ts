import type { NodeKey } from "lexical";

/**
 * Entry side for inline format source editing — whether the cursor enters
 * from the left (start) or right (end) of the formatted span. Matches the
 * EntrySide type in inline-format-source.ts but declared independently so
 * that src/state/ does not import from src/lexical/ internals.
 */
export type InlineSourceEntrySide = "start" | "end";

/**
 * Describes the inline format source editing state.
 *
 * "inactive" — no inline source editing is active
 * "active" — an InlineFormatSourceNode is being edited
 */
export type InlineSourceState =
  | { readonly status: "inactive" }
  | {
      readonly status: "active";
      readonly nodeKey: NodeKey;
      readonly entrySide: InlineSourceEntrySide;
    };

export const INLINE_SOURCE_INACTIVE: InlineSourceState = { status: "inactive" };

export function inlineSourceActive(
  nodeKey: NodeKey,
  entrySide: InlineSourceEntrySide,
): InlineSourceState {
  return { status: "active", nodeKey, entrySide };
}

export function isInlineSourceActive(state: InlineSourceState): state is Extract<InlineSourceState, { status: "active" }> {
  return state.status === "active";
}
