/**
 * CM6 StateField that parses and caches frontmatter configuration.
 *
 * Provides `FrontmatterConfig` to other extensions via
 * `state.field(frontmatterField)` and a decoration that renders
 * the document title (from frontmatter) in Typora-style mode,
 * revealing the raw YAML when the cursor is inside the region.
 */
import { EditorState, type Extension, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import {
  parseFrontmatter,
  type FrontmatterConfig,
  type FrontmatterResult,
} from "../parser/frontmatter";
import {
  editorFocusField,
  focusEffect,
  focusTracker,
} from "../render/render-utils";

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

/** Widget that renders the document title from frontmatter. */
class TitleWidget extends WidgetType {
  constructor(private readonly title: string) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cg-doc-title";
    el.textContent = this.title;
    return el;
  }

  eq(other: TitleWidget): boolean {
    return this.title === other.title;
  }

  ignoreEvent(): boolean {
    // Let CM6 handle clicks → places cursor at position 0 → reveals YAML source
    return false;
  }
}

/**
 * CM6 StateField that renders frontmatter in Typora style:
 * - Editor focused + cursor inside frontmatter: show raw YAML for editing
 * - Otherwise: replace with a document title widget (if title present)
 *   or hide entirely (if no title)
 */
const frontmatterDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect))
    ) {
      return buildDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/**
 * The StateField for tests and direct field access.
 * Use `frontmatterDecoration` (the full extension) in the editor.
 */
export { frontmatterDecorationField };

/**
 * CM6 extension that hides frontmatter and renders a document title widget.
 * Includes the focus tracker so focus/blur toggling works correctly.
 */
export const frontmatterDecoration: Extension = [
  editorFocusField,
  focusTracker,
  frontmatterDecorationField,
];

/** Build decorations for the frontmatter region. */
function buildDecorations(state: EditorState): DecorationSet {
  const { end, config } = state.field(frontmatterField);
  if (end <= 0) return Decoration.none;

  // Only reveal raw YAML when the editor is focused and cursor is inside
  const focused = state.field(editorFocusField, false) ?? false;
  const cursor = state.selection.main;
  if (focused && cursor.from < end) {
    return Decoration.none;
  }

  // Otherwise: replace frontmatter with title widget (or hide)
  if (config.title) {
    return Decoration.set([
      Decoration.replace({
        widget: new TitleWidget(config.title),
        block: true,
      }).range(0, end),
    ]);
  }

  return Decoration.set([Decoration.replace({}).range(0, end)]);
}
