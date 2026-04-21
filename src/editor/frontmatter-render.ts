/**
 * CM6 extension for Typora-style frontmatter rendering.
 *
 * Reveals raw YAML only when explicit structure editing is active;
 * otherwise replaces it with a document title widget (or hides it
 * entirely when there is no title).
 */
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import { CSS } from "../constants/css-classes";

import { frontmatterField } from "./frontmatter-state";
import {
  createDecorationsField,
  editorFocusField,
  focusTracker,
  ShellMacroAwareWidget,
} from "../render/render-core";
import type { Transaction } from "@codemirror/state";
import {
  activateFrontmatterStructureEdit,
  hasStructureEditEffect,
  isFrontmatterStructureEditActive,
} from "../state/cm-structure-edit";
import { isFrontmatterActive } from "../state/shell-ownership";

/** Widget that renders the document title from frontmatter. */
class TitleWidget extends ShellMacroAwareWidget {
  constructor(
    private readonly title: string,
    private readonly macros: Record<string, string>,
    private readonly active: boolean = false,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("div");
      el.className = this.active ? `${CSS.docTitle} ${CSS.activeShellWidget}` : CSS.docTitle;
      renderDocumentFragmentToDom(el, {
        kind: "title",
        text: this.title,
        macros: this.macros,
      });
      return el;
    });
  }

  eq(other: TitleWidget): boolean {
    return (
      this.title === other.title &&
      this.macrosKey === other.macrosKey &&
      this.active === other.active
    );
  }

  protected override bindSourceReveal(
    el: HTMLElement,
    view: import("@codemirror/view").EditorView,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      activateFrontmatterStructureEdit(view);
    });
  }
}

/**
 * CM6 StateField that renders frontmatter in Typora style:
 * - Explicit structure edit active: show raw YAML for editing
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

function shouldShowFrontmatterSource(state: EditorState): boolean {
  const { end } = state.field(frontmatterField);
  if (end <= 0) return false;
  return isFrontmatterStructureEditActive(state);
}

function frontmatterShouldRebuild(tr: Transaction): boolean {
  if (hasStructureEditEffect(tr)) {
    return true;
  }
  if (tr.state.field(frontmatterField) !== tr.startState.field(frontmatterField)) {
    return true;
  }
  return isFrontmatterActive(tr.startState) !== isFrontmatterActive(tr.state);
}

/** Build decorations for the frontmatter region. */
function buildDecorations(state: EditorState): DecorationSet {
  const { end, config } = state.field(frontmatterField);
  if (end <= 0) return Decoration.none;
  const active = isFrontmatterActive(state);

  if (shouldShowFrontmatterSource(state)) {
    const decos: Range<Decoration>[] = [];
    const doc = state.doc;
    for (let pos = 0; pos < end; ) {
      const line = doc.lineAt(pos);
      const isFirst = line.from === 0;
      const isLast = line.to + 1 >= end;
      const className = [
        "cf-frontmatter-line",
        active ? CSS.activeShell : "",
        active && isFirst ? CSS.activeShellTop : "",
        active && isLast ? CSS.activeShellBottom : "",
      ].filter(Boolean).join(" ");
      decos.push(Decoration.line({ class: className }).range(line.from));
      pos = line.to + 1;
    }
    return Decoration.set(decos);
  }

  if (config.title) {
    const macros = config.math ?? {};
    const widget = new TitleWidget(config.title, macros, active);
    widget.updateSourceRange(0, end);
    return Decoration.set([
      Decoration.replace({
        widget,
        block: true,
      }).range(0, end),
    ]);
  }

  return Decoration.set([Decoration.replace({}).range(0, end)]);
}
