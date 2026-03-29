/**
 * CM6 extension for Typora-style frontmatter rendering.
 *
 * Reveals raw YAML when the cursor is inside the frontmatter region
 * while the editor is focused; otherwise replaces it with a document
 * title widget (or hides it entirely when there is no title).
 */
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { renderDocumentFragmentToDom } from "../document-surfaces";

import { frontmatterField } from "./frontmatter-state";
import {
  createDecorationsField,
  editorFocusField,
  focusTracker,
  focusEffect,
  RenderWidget,
  serializeMacros,
} from "../render/render-core";
import type { Transaction } from "@codemirror/state";

/** Widget that renders the document title from frontmatter. */
class TitleWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly title: string,
    private readonly macros: Record<string, string>,
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("div");
      el.className = "cf-doc-title";
      renderDocumentFragmentToDom(el, {
        kind: "title",
        text: this.title,
        macros: this.macros,
      });
      return el;
    });
  }

  eq(other: TitleWidget): boolean {
    return this.title === other.title && this.macrosKey === other.macrosKey;
  }

  /**
   * Override to return false: CM6 handles click events on the title widget
   * to place the cursor at position 0, revealing the YAML source for editing.
   */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * CM6 StateField that renders frontmatter in Typora style:
 * - Editor focused + cursor inside frontmatter: show raw YAML for editing
 * - Otherwise: replace with a document title widget (if title present)
 *   or hide entirely (if no title)
 */
const frontmatterDecorationField = createDecorationsField(
  buildDecorations,
  frontmatterShouldRebuild,
  true, // map on docChanged — frontmatter decorations depend on structure, not text
);

/**
 * The StateField for test access only.
 *
 * @internal This is exported only for testing purposes. Use `frontmatterDecoration`
 * (the full extension) in the editor. Tests should access this field via the
 * StateField returned by this export.
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

/** Line decoration applied to each frontmatter line when editing. */
const frontmatterLineDeco = Decoration.line({ class: "cf-frontmatter-line" });

function shouldShowFrontmatterSource(state: EditorState): boolean {
  const { end } = state.field(frontmatterField);
  if (end <= 0) return false;
  const focused = state.field(editorFocusField, false) ?? false;
  return focused && state.selection.main.from < end;
}

function frontmatterShouldRebuild(tr: Transaction): boolean {
  if (tr.effects.some((effect) => effect.is(focusEffect))) {
    return true;
  }
  if (tr.state.field(frontmatterField) !== tr.startState.field(frontmatterField)) {
    return true;
  }
  if (tr.selection === undefined) return false;
  return shouldShowFrontmatterSource(tr.state) !== shouldShowFrontmatterSource(tr.startState);
}

/** Build decorations for the frontmatter region. */
function buildDecorations(state: EditorState): DecorationSet {
  const { end, config } = state.field(frontmatterField);
  if (end <= 0) return Decoration.none;

  // Only reveal raw YAML when the editor is focused and cursor is inside
  if (shouldShowFrontmatterSource(state)) {
    // Apply monospace line decorations to all frontmatter lines
    const decos: Range<Decoration>[] = [];
    const doc = state.doc;
    for (let pos = 0; pos < end; ) {
      const line = doc.lineAt(pos);
      decos.push(frontmatterLineDeco.range(line.from));
      pos = line.to + 1;
    }
    return Decoration.set(decos);
  }

  // Otherwise: replace frontmatter with title widget (or hide)
  if (config.title) {
    const macros = config.math ?? {};
    return Decoration.set([
      Decoration.replace({
        widget: new TitleWidget(config.title, macros),
        block: true,
      }).range(0, end),
    ]);
  }

  return Decoration.set([Decoration.replace({}).range(0, end)]);
}
