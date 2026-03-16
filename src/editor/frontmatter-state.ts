/**
 * CM6 StateField that parses and caches frontmatter configuration.
 *
 * Provides `FrontmatterConfig` to other extensions via
 * `state.field(frontmatterField)` and an optional decoration
 * that hides the frontmatter region in Typora-style rendering.
 */
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

import {
  parseFrontmatter,
  type FrontmatterConfig,
  type FrontmatterResult,
} from "../parser/frontmatter";

export { type FrontmatterConfig } from "../parser/frontmatter";

/** State stored in the frontmatter field. */
export interface FrontmatterState {
  /** Parsed configuration from the frontmatter. */
  config: FrontmatterConfig;
  /** Character offset where the frontmatter ends (-1 if none). */
  end: number;
}

/** Parse frontmatter from an EditorState's document. */
function parseFrontmatterFromState(state: EditorState): FrontmatterResult {
  // Read only the first portion of the document to find frontmatter.
  // Frontmatter is at the very start, so we don't need the entire doc.
  const maxScan = Math.min(state.doc.length, 4096);
  const prefix = state.doc.sliceString(0, maxScan);
  return parseFrontmatter(prefix);
}

/**
 * CM6 StateField holding the parsed frontmatter config.
 *
 * Usage:
 * ```ts
 * const config = state.field(frontmatterField).config;
 * ```
 */
export const frontmatterField = StateField.define<FrontmatterState>({
  create(state) {
    const result = parseFrontmatterFromState(state);
    return { config: result.config, end: result.end };
  },

  update(value, tr) {
    if (!tr.docChanged) return value;

    // Check if the change affects the frontmatter region.
    // If the frontmatter ends at `value.end`, any change before that
    // offset (or at position 0) could modify the frontmatter.
    let affectsFrontmatter = false;

    if (value.end === -1) {
      // No frontmatter currently: only re-parse if the change is at the start
      tr.changes.iterChangedRanges((fromA) => {
        if (fromA === 0) affectsFrontmatter = true;
      });
    } else {
      tr.changes.iterChangedRanges((fromA) => {
        if (fromA < value.end) affectsFrontmatter = true;
      });
    }

    if (!affectsFrontmatter) return value;

    const result = parseFrontmatterFromState(tr.state);
    return { config: result.config, end: result.end };
  },
});

/** Widget-replace decoration that hides a range of text. */
const hiddenDecoration = Decoration.replace({});

/**
 * CM6 StateField that provides a DecorationSet hiding the frontmatter
 * block in Typora-style rendering mode.
 *
 * Add this to your extensions to hide frontmatter visually:
 * ```ts
 * extensions: [frontmatterField, frontmatterDecoration]
 * ```
 */
export const frontmatterDecoration = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },

  update(value, tr) {
    if (!tr.docChanged) return value;
    return buildDecorations(tr.state);
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** Build decorations that hide the frontmatter region. */
function buildDecorations(state: EditorState): DecorationSet {
  const { end } = state.field(frontmatterField);
  if (end <= 0) return Decoration.none;

  return Decoration.set([hiddenDecoration.range(0, end)]);
}
