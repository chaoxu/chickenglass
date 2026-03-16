/**
 * Extract math macros from frontmatter and provide them to KaTeX.
 *
 * Reads the `math` field from the frontmatter StateField and converts
 * it to the format expected by KaTeX's `macros` option:
 * `{ "\\R": "\\mathbb{R}", "\\F": "\\mathcal{F}" }`
 */
import { type EditorState } from "@codemirror/state";

import { frontmatterField } from "../editor/frontmatter-state";

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
