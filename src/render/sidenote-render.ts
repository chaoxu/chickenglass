/**
 * CM6 StateField that renders footnotes as Tufte-style sidenotes.
 *
 * - FootnoteRef [^id] outside cursor → superscript number widget
 * - FootnoteDef [^id]: content outside cursor → margin-positioned sidenote widget
 *   with the definition line hidden (replaced by the sidenote in the margin)
 *
 * Uses a StateField (not ViewPlugin) so that line decorations and
 * block-level replace decorations are permitted by CM6.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type EditorState, type Extension, type Range, StateField, StateEffect } from "@codemirror/state";

import {
  buildDecorations,
  createBooleanToggleField,
  cursorInRange,
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./render-utils";
import { mathMacrosField } from "./math-macros";
import { renderInlineMarkdown } from "./inline-render";
import {
  type FootnoteSemantics,
  numberFootnotes,
  orderedFootnoteEntries,
} from "../semantics/document";
import { documentSemanticsField } from "../semantics/codemirror-source";

/** StateEffect to toggle sidenote margin visibility. */
export const sidenotesCollapsedEffect = StateEffect.define<boolean>();

/** StateField tracking whether the sidenote margin is collapsed. */
export const sidenotesCollapsedField = createBooleanToggleField(sidenotesCollapsedEffect);


/** Collect footnote references and definitions from the shared semantics field. */
export function collectFootnotes(state: EditorState): FootnoteSemantics {
  return state.field(documentSemanticsField).footnotes;
}

/** Widget for a footnote reference rendered as a superscript number. */
class FootnoteRefWidget extends RenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const sup = document.createElement("sup");
    sup.className = "cf-sidenote-ref";
    sup.textContent = String(this.number);
    sup.title = `Footnote ${this.id}`;
    sup.setAttribute("data-footnote-id", this.id);
    return sup;
  }

  eq(other: FootnoteRefWidget): boolean {
    return this.number === other.number && this.id === other.id;
  }
}

/** Build sidenote decorations from editor state. */
function buildSidenoteDecorations(state: EditorState, focused: boolean): DecorationSet {
  const footnotes = collectFootnotes(state);
  const items: Range<Decoration>[] = [];
  const numberMap = numberFootnotes(footnotes);

  // Render refs as superscript numbers
  for (const ref of footnotes.refs) {
    if (focused && cursorInRange(state, ref.from, ref.to)) continue;

    const num = numberMap.get(ref.id) ?? 0;
    const widget = new FootnoteRefWidget(num, ref.id);
    widget.sourceFrom = ref.from;
    items.push(Decoration.replace({ widget }).range(ref.from, ref.to));
  }

  // Hide footnote definition lines — whether margin is visible (content shown
  // in margin) or collapsed (content shown in bottom footnote section).
  // When cursor is inside a def, show source for editing.
  for (const [, def] of footnotes.defs) {
    if (focused && cursorInRange(state, def.from, def.to)) continue;

    // Collapse the definition line to zero height
    items.push(
      Decoration.line({ class: "cf-sidenote-def-line" }).range(def.from),
    );
    // Replace text content (after label) with empty widget to hide it visually
    if (def.labelTo < def.to) {
      items.push(
        Decoration.replace({}).range(def.labelTo, def.to),
      );
    }
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides sidenote rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) are permitted.
 */
const sidenoteDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildSidenoteDecorations(state, false);
  },

  update(value, tr) {
    if (
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect) || e.is(sidenotesCollapsedEffect)) ||
      tr.state.field(documentSemanticsField) !== tr.startState.field(documentSemanticsField)
    ) {
      const focused = tr.state.field(editorFocusField, false) ?? false;
      return buildSidenoteDecorations(tr.state, focused);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** Minimum vertical gap in pixels between stacked sidenotes. */
const SIDENOTE_GAP = 4;

/** Measurement data for a single sidenote used by the collision resolver. */
export interface SidenoteMeasurement {
  readonly top: number;
  readonly height: number;
}

/**
 * Compute translateY offsets to resolve vertical overlap between sidenotes.
 *
 * Walks top-to-bottom, tracking the bottom edge of the last placed sidenote.
 * If the next sidenote's top is above that edge (plus gap), it gets pushed down.
 *
 * Returns an array of pixel offsets (0 means no adjustment needed).
 */
export function computeSidenoteOffsets(
  measurements: readonly SidenoteMeasurement[],
  gap: number = SIDENOTE_GAP,
): number[] {
  const offsets = new Array<number>(measurements.length).fill(0);
  let prevBottom = -Infinity;

  for (let i = 0; i < measurements.length; i++) {
    const { top, height } = measurements[i];
    if (top < prevBottom + gap) {
      offsets[i] = prevBottom + gap - top;
    }
    prevBottom = top + offsets[i] + height;
  }

  return offsets;
}


/** Widget that renders a "Footnotes" section at the bottom when sidenotes are collapsed. */
class FootnoteSectionWidget extends RenderWidget {
  constructor(
    private readonly entries: ReadonlyArray<{ num: number; id: string; content: string; defFrom: number }>,
    private readonly macros: Record<string, string>,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const section = document.createElement("div");
    section.className = "cf-bibliography";
    section.style.marginTop = "2em";

    const heading = document.createElement("h2");
    heading.className = "cf-bibliography-heading";
    heading.textContent = "Footnotes";
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "cf-bibliography-list";

    for (const entry of this.entries) {
      const div = document.createElement("div");
      div.className = "cf-bibliography-entry";
      div.style.cursor = "pointer";
      div.style.fontSize = "0.85em";
      div.style.lineHeight = "1.6";
      div.style.marginBottom = "4px";

      const num = document.createElement("sup");
      num.style.fontWeight = "600";
      num.style.marginRight = "4px";
      num.textContent = String(entry.num);
      div.appendChild(num);

      const content = document.createElement("span");
      renderInlineMarkdown(content, entry.content, this.macros);
      div.appendChild(content);

      const defFrom = entry.defFrom;
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.focus();
        view.dispatch({
          selection: { anchor: defFrom },
          scrollIntoView: true,
        });
      });

      list.appendChild(div);
    }

    section.appendChild(list);
    return section;
  }

  eq(other: FootnoteSectionWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    return this.entries.every((e, i) => e.id === other.entries[i].id && e.content === other.entries[i].content);
  }
}

/** ViewPlugin that adds a "Footnotes" section at the end of the document when sidenotes are collapsed. */
class FootnoteSectionPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(sidenotesCollapsedEffect)),
      ) ||
      update.state.field(documentSemanticsField) !== update.startState.field(documentSemanticsField)
    ) {
      this.decorations = this.build(update.view);
    }
  }

  private build(view: EditorView): DecorationSet {
    const collapsed = view.state.field(sidenotesCollapsedField, false) ?? false;
    if (!collapsed) return Decoration.none;

    const footnotes = collectFootnotes(view.state);
    if (footnotes.defs.size === 0) return Decoration.none;

    const entries = orderedFootnoteEntries(footnotes).map((entry) => ({
      num: entry.number,
      id: entry.id,
      content: entry.def.content,
      defFrom: entry.def.from,
    }));

    const endPos = view.state.doc.length;
    const macros = view.state.field(mathMacrosField);
    const widget = new FootnoteSectionWidget(entries, macros);
    return buildDecorations([
      Decoration.widget({ widget, side: 1 }).range(endPos),
    ]);
  }
}

const footnoteSectionPlugin = ViewPlugin.fromClass(FootnoteSectionPlugin, {
  decorations: (v) => v.decorations,
});

/** CM6 extension that renders footnote refs as superscripts and hides defs.
 *  Sidenote content is rendered by the React SidenoteMargin component. */
export const sidenoteRenderPlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  sidenotesCollapsedField,
  sidenoteDecorationField,
  footnoteSectionPlugin,
];
