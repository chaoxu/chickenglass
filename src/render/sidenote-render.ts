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
 * Inline expansion (#458): clicking a footnote ref when sidenotes are
 * collapsed expands the definition content inline below the ref, so the
 * user can read and navigate to the definition without scrolling away.
 *
 * Uses a StateField (not ViewPlugin) so that line decorations and
 * block-level replace decorations are permitted by CM6.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
  WidgetType,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";

import {
  buildDecorations,
  createBooleanToggleField,
  createDecorationsField,
  cursorInRange,
  defaultShouldRebuild,
  pushWidgetDecoration,
  addMarkerReplacement,
  cloneRenderedHTMLElement,
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

// ---------------------------------------------------------------------------
// Inline footnote expansion (#458)
// ---------------------------------------------------------------------------

/** StateEffect to toggle inline expansion of a footnote ref. */
export const footnoteInlineToggleEffect = StateEffect.define<{ id: string; expanded: boolean }>();

/**
 * StateField tracking which footnote IDs are currently expanded inline.
 *
 * When a user clicks a footnote ref in collapsed-sidenotes mode, the
 * definition content appears inline below the ref line instead of scrolling
 * to the definition. This keeps the user in reading context.
 */
export const footnoteInlineExpandedField = StateField.define<ReadonlySet<string>>({
  create() {
    return new Set<string>();
  },
  update(value, tr) {
    let changed = false;
    let next: Set<string> | undefined;
    for (const effect of tr.effects) {
      if (effect.is(footnoteInlineToggleEffect)) {
        if (!next) next = new Set(value);
        if (effect.value.expanded) {
          next.add(effect.value.id);
        } else {
          next.delete(effect.value.id);
        }
        changed = true;
      }
    }
    return changed && next ? next : value;
  },
});

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
 * superscript toggles inline expansion of the footnote definition below
 * the ref (#458). When sidenotes are expanded (margin visible), clicking
 * navigates to the definition. Otherwise, the default source-reveal
 * behavior places the cursor on the ref source.
 */
class FootnoteRefWidget extends SimpleTextRenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
    /** Document offset of the footnote definition, or -1 if none exists. */
    private readonly defFrom: number,
    /** Whether this ref's footnote is currently expanded inline. */
    private readonly inlineExpanded: boolean,
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

    if (this.inlineExpanded) {
      el.classList.add("cf-sidenote-ref-expanded");
    }

    if (view && this.defFrom >= 0) {
      el.style.cursor = "pointer";
      const id = this.id;
      const defFrom = this.defFrom;
      const inlineExpanded = this.inlineExpanded;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const collapsed = view.state.field(sidenotesCollapsedField, false) ?? false;
        if (collapsed) {
          // Collapsed mode: toggle inline expansion (#458)
          view.dispatch({
            effects: footnoteInlineToggleEffect.of({ id, expanded: !inlineExpanded }),
          });
        } else {
          // Expanded mode (margin visible): navigate to definition
          view.focus();
          view.dispatch({ selection: { anchor: defFrom }, scrollIntoView: true });
        }
      });
    } else if (view && this.sourceFrom >= 0) {
      this.bindSourceReveal(el, view);
    }

    return el;
  }

  eq(other: FootnoteRefWidget): boolean {
    return (
      this.number === other.number &&
      this.id === other.id &&
      this.defFrom === other.defFrom &&
      this.inlineExpanded === other.inlineExpanded
    );
  }
}

/**
 * Widget that renders an inline footnote expansion below the ref line (#458).
 *
 * Shows a bordered box with the footnote number, rendered content, and an
 * "edit" link that navigates to the actual definition for editing. Clicking
 * the superscript ref again collapses this widget.
 *
 * Uses a plain WidgetType (not RenderWidget) because it is placed via
 * Decoration.widget with block:true, not Decoration.replace.
 */
export class FootnoteInlineWidget extends WidgetType {
  private readonly macrosKey: string;
  private cachedDOM: HTMLElement | null = null;

  constructor(
    private readonly number: number,
    private readonly id: string,
    private readonly content: string,
    private readonly macros: Record<string, string>,
    private readonly defFrom: number,
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  private createCachedDOM(): HTMLElement {
    if (this.cachedDOM) {
      return cloneRenderedHTMLElement(this.cachedDOM);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "cf-footnote-inline";
    wrapper.setAttribute("aria-label", `Footnote ${this.id} content`);

    const header = document.createElement("div");
    header.className = "cf-footnote-inline-header";

    const num = document.createElement("sup");
    num.className = "cf-footnote-inline-number";
    num.textContent = String(this.number);
    header.appendChild(num);

    const editBtn = document.createElement("button");
    editBtn.className = "cf-footnote-inline-edit";
    editBtn.textContent = "Edit";
    editBtn.title = "Navigate to footnote definition";
    header.appendChild(editBtn);
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.className = "cf-footnote-inline-body";
    renderDocumentFragmentToDom(body, {
      kind: "footnote",
      text: this.content,
      macros: this.macros,
    });
    wrapper.appendChild(body);

    this.cachedDOM = cloneRenderedHTMLElement(wrapper);
    return wrapper;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = this.createCachedDOM();
    const editBtn = wrapper.querySelector<HTMLButtonElement>(".cf-footnote-inline-edit");
    if (!editBtn) return wrapper;

    const defFrom = this.defFrom;
    const id = this.id;
    editBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Uncollapse sidenotes and navigate to definition
      view.dispatch({
        effects: [
          sidenotesCollapsedEffect.of(false),
          footnoteInlineToggleEffect.of({ id, expanded: false }),
        ],
        selection: { anchor: defFrom },
        scrollIntoView: true,
      });
      view.focus();
    });
    return wrapper;
  }

  eq(other: FootnoteInlineWidget): boolean {
    return (
      this.number === other.number &&
      this.id === other.id &&
      this.content === other.content &&
      this.defFrom === other.defFrom &&
      this.macrosKey === other.macrosKey
    );
  }

  /** Block this widget from CM6 event handling — we handle clicks ourselves. */
  ignoreEvent(): boolean {
    return true;
  }
}

/** Build sidenote decorations from editor state. */
export function buildSidenoteDecorations(state: EditorState, focused: boolean): DecorationSet {
  const collapsed = state.field(sidenotesCollapsedField, false) ?? false;
  const inlineExpanded = state.field(footnoteInlineExpandedField, false) ?? new Set<string>();

  const footnotes = collectFootnotes(state);
  const items: Range<Decoration>[] = [];
  const numberMap = numberFootnotes(footnotes);
  const macros = state.field(mathMacrosField, false) ?? {};

  // Render refs as superscript numbers (both collapsed and expanded modes).
  // Each ref widget receives the definition's document offset so that clicking
  // the superscript can navigate directly to the editable definition.
  // In collapsed mode, expanded refs also get an inline widget below the line.
  for (const ref of footnotes.refs) {
    if (focused && cursorInRange(state, ref.from, ref.to)) continue;

    const num = numberMap.get(ref.id) ?? 0;
    const def = footnotes.defs.get(ref.id);
    const isExpanded = inlineExpanded.has(ref.id);
    pushWidgetDecoration(
      items,
      new FootnoteRefWidget(num, ref.id, def?.from ?? -1, isExpanded),
      ref.from,
      ref.to,
    );

    // Inline expansion: show footnote content below the ref line (#458)
    if (collapsed && isExpanded && def) {
      const refLine = state.doc.lineAt(ref.from);
      const widget = new FootnoteInlineWidget(num, ref.id, def.content, macros, def.from);
      items.push(
        Decoration.widget({ widget, block: true, side: 1 }).range(refLine.to),
      );
    }
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
    tr.effects.some((e) => e.is(sidenotesCollapsedEffect) || e.is(footnoteInlineToggleEffect)) ||
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

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
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
        div.dataset.defFrom = String(entry.defFrom);
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

        list.appendChild(div);
      }

      section.appendChild(list);
      return section;
    });
  }

  toDOM(view: EditorView): HTMLElement {
    const section = this.createDOM();
    for (const div of section.querySelectorAll<HTMLElement>(".cf-bibliography-entry")) {
      const defFrom = Number(div.dataset.defFrom ?? "-1");
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.focus();
        view.dispatch({
          effects: sidenotesCollapsedEffect.of(false),
          selection: { anchor: defFrom },
          scrollIntoView: true,
        });
      });
    }
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
  footnoteInlineExpandedField,
  sidenoteDecorationField,
  footnoteSectionPlugin,
];
