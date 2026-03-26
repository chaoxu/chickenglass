/**
 * CM6 StateField that renders footnotes as Tufte-style sidenotes.
 *
 * Footnote body content stays in the CM6 document model as normal editable
 * text. Only the `[^id]:` label prefix is hidden (via Decoration.replace)
 * and the body is styled with a line decoration. This lets CM6's built-in
 * inline extensions (math, bold, citations) render footnote content
 * naturally — no separate re-rendering via widgets.
 *
 * - FootnoteRef [^id] outside cursor → superscript number widget
 * - FootnoteDef in expanded mode:
 *   - [^id]: label → hidden via Decoration.replace (shown on cursor contact)
 *   - body text → stays as normal CM6 content, styled via Decoration.line
 * - FootnoteDef in collapsed mode:
 *   - entire line hidden (content shown in FootnoteSectionWidget at bottom)
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
  addMarkerReplacement,
  serializeMacros,
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

/** Widget for the [^id]: label, rendered as a small superscript number. */
class FootnoteDefLabelWidget extends SimpleTextRenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
  ) {
    super({
      tagName: "sup",
      className: "cf-sidenote-def-label",
      text: String(number),
    });
  }

  eq(other: FootnoteDefLabelWidget): boolean {
    return this.number === other.number && this.id === other.id;
  }
}

/** Widget for a footnote reference rendered as a superscript number.
 *
 * When sidenotes are collapsed and a definition exists, clicking the
 * superscript scrolls to and reveals the footnote definition (uncollapsing
 * sidenotes and placing the cursor on the definition). Otherwise, the
 * default source-reveal behavior places the cursor on the ref source.
 */
class FootnoteRefWidget extends SimpleTextRenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
    /** Document offset of the footnote definition, or -1 if none exists. */
    private readonly defFrom: number,
  ) {
    super({
      tagName: "sup",
      className: "cf-sidenote-ref",
      text: String(number),
      attrs: { "data-footnote-id": id, "aria-label": `Footnote ${id}` },
    });
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.setSourceRangeAttrs(el);

    if (view && this.defFrom >= 0) {
      // Click navigates to the footnote definition:
      // - Uncollapse sidenotes so the definition becomes visible/editable
      // - Place cursor at the definition and scroll into view
      el.style.cursor = "pointer";
      const defFrom = this.defFrom;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const collapsed = view.state.field(sidenotesCollapsedField, false) ?? false;
        if (collapsed) {
          view.dispatch({ effects: sidenotesCollapsedEffect.of(false) });
        }
        view.focus();
        view.dispatch({ selection: { anchor: defFrom }, scrollIntoView: true });
      });
    } else if (view && this.sourceFrom >= 0) {
      this.bindSourceReveal(el, view);
    }

    return el;
  }

  eq(other: FootnoteRefWidget): boolean {
    return this.number === other.number && this.id === other.id && this.defFrom === other.defFrom;
  }
}

/** Build sidenote decorations from editor state. */
export function buildSidenoteDecorations(state: EditorState, focused: boolean): DecorationSet {
  const collapsed = state.field(sidenotesCollapsedField, false) ?? false;

  const footnotes = collectFootnotes(state);
  const items: Range<Decoration>[] = [];
  const numberMap = numberFootnotes(footnotes);

  // Render refs as superscript numbers (both collapsed and expanded modes).
  // Each ref widget receives the definition's document offset so that clicking
  // the superscript can navigate directly to the editable definition.
  for (const ref of footnotes.refs) {
    if (focused && cursorInRange(state, ref.from, ref.to)) continue;

    const num = numberMap.get(ref.id) ?? 0;
    const def = footnotes.defs.get(ref.id);
    pushWidgetDecoration(items, new FootnoteRefWidget(num, ref.id, def?.from ?? -1), ref.from, ref.to);
  }

  for (const [, def] of footnotes.defs) {
    if (collapsed) {
      // Collapsed mode: hide entire definition line (content shown in footnote section).
      items.push(
        Decoration.line({ class: "cf-sidenote-def-line" }).range(def.from),
      );
      items.push(
        Decoration.replace({}).range(def.from, def.to),
      );
      continue;
    }

    // Expanded mode: body text stays in CM6 as normal editable content.
    // Only the [^id]: label prefix is hidden/shown based on cursor position.
    const cursorOnLabel = focused && cursorInRange(state, def.from, def.labelTo);

    // Apply line styling for footnote body (smaller font, muted color).
    items.push(
      Decoration.line({ class: "cf-sidenote-def-body" }).range(def.from),
    );

    // Hide [^id]: label via Decoration.replace with a small number widget.
    // When cursor is on the label, show it as source (heading-like pattern).
    const num = numberMap.get(def.id) ?? 0;
    const labelWidget = new FootnoteDefLabelWidget(num, def.id);
    addMarkerReplacement(def.from, def.labelTo, cursorOnLabel, labelWidget, items);
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
          effects: sidenotesCollapsedEffect.of(false),
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
    return this.entries.every(
      (e, i) =>
        e.id === other.entries[i].id &&
        e.content === other.entries[i].content &&
        e.num === other.entries[i].num &&
        e.defFrom === other.entries[i].defFrom,
    ) && this.macrosKey === other.macrosKey;
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
