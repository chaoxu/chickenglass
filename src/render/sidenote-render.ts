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
import { type EditorState, type Extension, type Range, StateEffect } from "@codemirror/state";

import {
  buildDecorations,
  createBooleanToggleField,
  createDecorationsField,
  cursorInRange,
  defaultShouldRebuild,
  pushWidgetDecoration,
  serializeMacros,
  MacroAwareWidget,
  RenderWidget,
  SimpleTextRenderWidget,
  editorFocusField,
  focusTracker,
} from "./render-utils";
import { mathMacrosField } from "./math-macros";
import {
  type FootnoteSemantics,
  numberFootnotes,
  orderedFootnoteEntries,
} from "../semantics/document";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { renderDocumentFragmentToDom } from "../document-surfaces";

/** StateEffect to toggle sidenote margin visibility. */
export const sidenotesCollapsedEffect = StateEffect.define<boolean>();

/** StateField tracking whether the sidenote margin is collapsed. */
export const sidenotesCollapsedField = createBooleanToggleField(sidenotesCollapsedEffect);


/** Collect footnote references and definitions from the shared semantics field. */
export function collectFootnotes(state: EditorState): FootnoteSemantics {
  return state.field(documentSemanticsField).footnotes;
}

/** Widget that renders footnote body content inline (math, bold, etc.). */
export class FootnoteBodyWidget extends MacroAwareWidget {
  constructor(
    private readonly content: string,
    private readonly macros: Record<string, string>,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cf-sidenote-body-rendered";
    renderDocumentFragmentToDom(span, {
      kind: "footnote",
      text: this.content,
      macros: this.macros,
    });
    return span;
  }

  eq(other: FootnoteBodyWidget): boolean {
    return this.content === other.content && this.macrosKey === other.macrosKey;
  }
}

/** Widget for a footnote reference rendered as a superscript number. */
class FootnoteRefWidget extends SimpleTextRenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
  ) {
    super({
      tagName: "sup",
      className: "cf-sidenote-ref",
      text: String(number),
      title: `Footnote ${id}`,
      attrs: { "data-footnote-id": id },
    });
  }

  eq(other: FootnoteRefWidget): boolean {
    return this.number === other.number && this.id === other.id;
  }
}

/** Build sidenote decorations from editor state. */
export function buildSidenoteDecorations(state: EditorState, focused: boolean): DecorationSet {
  const collapsed = state.field(sidenotesCollapsedField, false) ?? false;
  if (collapsed) return Decoration.none;

  const footnotes = collectFootnotes(state);
  const items: Range<Decoration>[] = [];
  const numberMap = numberFootnotes(footnotes);

  // Render refs as superscript numbers
  for (const ref of footnotes.refs) {
    if (focused && cursorInRange(state, ref.from, ref.to)) continue;

    const num = numberMap.get(ref.id) ?? 0;
    pushWidgetDecoration(items, new FootnoteRefWidget(num, ref.id), ref.from, ref.to);
  }

  // Heading-like pattern for footnote defs: when cursor is inside the def,
  // the [^id]: label stays as source but the body keeps inline rendering
  // via a FootnoteBodyWidget. Cursor anywhere in the def — label or body —
  // gets the same treatment: label visible as source, body rendered.
  const macros = state.field(mathMacrosField);
  for (const [, def] of footnotes.defs) {
    const cursorInDef = focused && cursorInRange(state, def.from, def.to);

    if (cursorInDef) {
      // Label stays as source; body keeps inline rendering via widget.
      if (def.labelTo < def.to) {
        pushWidgetDecoration(items, new FootnoteBodyWidget(def.content, macros), def.labelTo, def.to);
      }
      continue;
    }

    // Cursor outside def — collapse the definition line.
    items.push(
      Decoration.line({ class: "cf-sidenote-def-line" }).range(def.from),
    );
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
const sidenoteDecorationField = createDecorationsField(
  (state) => {
    const focused = state.field(editorFocusField, false) ?? false;
    return buildSidenoteDecorations(state, focused);
  },
  (tr) =>
    defaultShouldRebuild(tr) ||
    tr.effects.some((e) => e.is(sidenotesCollapsedEffect)) ||
    tr.state.field(documentSemanticsField) !== tr.startState.field(documentSemanticsField),
);

export { sidenoteDecorationField };

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
export class FootnoteSectionWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly entries: ReadonlyArray<{ num: number; id: string; content: string; defFrom: number }>,
    private readonly macros: Record<string, string>,
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
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
      renderDocumentFragmentToDom(content, {
        kind: "footnote",
        text: entry.content,
        macros: this.macros,
      });
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
    return this.entries.every((e, i) => e.id === other.entries[i].id && e.content === other.entries[i].content)
      && this.macrosKey === other.macrosKey;
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
      update.docChanged ||
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
