/**
 * Extract math macros from frontmatter and provide them to KaTeX.
 *
 * Reads the `math` field from the frontmatter StateField and converts
 * it to the format expected by KaTeX's `macros` option:
 * `{ "\\R": "\\mathbb{R}", "\\F": "\\mathcal{F}" }`
 *
 * The `mathMacrosField` StateField caches the result so that multiple
 * consumers (math-render, math-preview, hover-preview, plugin-render,
 * sidenote-render) share one lookup instead of each independently
 * parsing frontmatter.
 */
import { type EditorState, StateField } from "@codemirror/state";

import { frontmatterField } from "../state/frontmatter-state";

/**
 * Read math macros from the frontmatter state field.
 *
 * Returns an empty record if no frontmatter is present or
 * the `math` field is missing/empty.
 */
export function getMathMacros(state: EditorState): Record<string, string> {
  const fm = state.field(frontmatterField, false);
  return fm?.config.math ?? {};
}

/**
 * CM6 StateField that caches the math macros record.
 *
 * Updates only when the frontmatter StateField value changes,
 * avoiding redundant object allocations on every transaction.
 */
export const mathMacrosField = StateField.define<Record<string, string>>({
  create(state) {
    return getMathMacros(state);
  },

  update(value, tr) {
    // The frontmatterField already performs its own change-detection
    // (only re-parses when edits touch the frontmatter region).
    // We compare by reference: if the frontmatter state object is the
    // same, the macros haven't changed either.
    const prev = tr.startState.field(frontmatterField, false);
    const next = tr.state.field(frontmatterField, false);
    if (prev === next) return value;
    return getMathMacros(tr.state);
  },
});
