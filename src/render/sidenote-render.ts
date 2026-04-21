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
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  type FootnoteSemantics,
  numberFootnotes,
  orderedFootnoteEntries,
} from "../semantics/document";
import { createChangeChecker } from "../state/change-detection";
import {
  getActiveStructureEditTarget,
  isFootnoteLabelStructureEditActive,
} from "../state/cm-structure-edit";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import {
  addMarkerReplacement,
  buildDecorations,
  pushWidgetDecoration,
} from "./decoration-core";
import { createDecorationsField } from "./decoration-field";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  FootnoteDefLabelWidget,
  FootnoteInlineWidget,
  FootnoteRefWidget,
} from "./sidenote-footnote-widgets";
// FootnoteDefLabelWidget extends SimpleTextRenderWidget in the helper module.
import { FootnoteSectionWidget } from "./sidenote-section-widget";
import {
  footnoteInlineExpandedField,
  footnoteInlineToggleEffect,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
} from "./sidenote-state";
import { serializeMacros } from "./source-widget";

export { FootnoteInlineWidget } from "./sidenote-footnote-widgets";
export { FootnoteSectionWidget } from "./sidenote-section-widget";
export {
  footnoteInlineExpandedField,
  footnoteInlineToggleEffect,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
} from "./sidenote-state";

/** Collect footnote references and definitions from the shared semantics field. */
export function collectFootnotes(state: EditorState): FootnoteSemantics {
  return state.field(documentSemanticsField).footnotes;
}

const footnoteSliceChanged = createChangeChecker(
  (state) => state.field(documentSemanticsField).footnotes,
  (state) => getDocumentAnalysisSliceRevision(state.field(documentSemanticsField), "footnotes"),
);

const EMPTY_MACROS: Record<string, string> = {};

function sameSerializedMacros(
  before: Record<string, string>,
  after: Record<string, string>,
): boolean {
  return before === after || serializeMacros(before) === serializeMacros(after);
}

const mathMacrosChanged = createChangeChecker({
  get: (state) => state.field(mathMacrosField, false) ?? EMPTY_MACROS,
  equals: sameSerializedMacros,
});

interface ActiveSidenoteCursorTarget {
  readonly kind: "label";
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

function getActiveSidenoteCursorTarget(
  state: EditorState,
): ActiveSidenoteCursorTarget | null {
  const collapsed = state.field(sidenotesCollapsedField, false) ?? false;
  if (collapsed) return null;
  const active = getActiveStructureEditTarget(state);
  return active?.kind === "footnote-label"
    ? {
        kind: "label",
        id: active.id,
        from: active.labelFrom,
        to: active.labelTo,
      }
    : null;
}

function sameCursorTarget(
  left: ActiveSidenoteCursorTarget | null,
  right: ActiveSidenoteCursorTarget | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.kind === right.kind
    && left.id === right.id
    && left.from === right.from
    && left.to === right.to
  );
}

function inlineFootnoteMacrosMatter(state: EditorState): boolean {
  const collapsed = state.field(sidenotesCollapsedField, false) ?? false;
  if (!collapsed) return false;

  const expanded = state.field(footnoteInlineExpandedField, false);
  return (expanded?.size ?? 0) > 0;
}

function sidenoteDecorationShouldRebuild(tr: Transaction): boolean {
  if (tr.effects.some((effect) =>
    effect.is(sidenotesCollapsedEffect) || effect.is(footnoteInlineToggleEffect)
  )) {
    return true;
  }

  if (footnoteSliceChanged(tr)) {
    return true;
  }

  if (
    (inlineFootnoteMacrosMatter(tr.startState) || inlineFootnoteMacrosMatter(tr.state))
    && mathMacrosChanged(tr)
  ) {
    return true;
  }

  return !sameCursorTarget(
    getActiveSidenoteCursorTarget(tr.startState),
    getActiveSidenoteCursorTarget(tr.state),
  );
}

function footnoteSectionShouldUpdate(update: ViewUpdate): boolean {
  const beforeCollapsed = update.startState.field(sidenotesCollapsedField, false) ?? false;
  const afterCollapsed = update.state.field(sidenotesCollapsedField, false) ?? false;

  if (beforeCollapsed !== afterCollapsed) {
    return true;
  }

  if (!afterCollapsed) {
    return false;
  }

  return (
    footnoteSliceChanged(update.startState, update.state)
    || mathMacrosChanged(update.startState, update.state)
  );
}

/** Build sidenote decorations from editor state. */
export function buildSidenoteDecorations(state: EditorState): DecorationSet {
  const collapsed = state.field(sidenotesCollapsedField, false) ?? false;
  const inlineExpanded = state.field(footnoteInlineExpandedField, false) ?? new Set<string>();

  const footnotes = collectFootnotes(state);
  const items: Range<Decoration>[] = [];
  const numberMap = numberFootnotes(footnotes);
  const macros = state.field(mathMacrosField, false) ?? {};
  const inlineSourceDecoration = Decoration.mark({ class: CSS.inlineSource });

  // Render refs as superscript numbers (both collapsed and expanded modes).
  // Each ref widget receives the definition's document offset so that clicking
  // the superscript can navigate directly to the editable definition.
  // In collapsed mode, expanded refs also get an inline widget below the line.
  for (const ref of footnotes.refs) {
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
    const cursorOnLabel = isFootnoteLabelStructureEditActive(state, def);

    // Apply line styling for footnote body (smaller font, muted color).
    items.push(
      Decoration.line({ class: "cf-sidenote-def-body" }).range(def.from),
    );

    // Hide [^id]: label via Decoration.replace with a small number widget.
    // When cursor is on the label, show it as source (heading-like pattern).
    const num = numberMap.get(def.id) ?? 0;
    const labelWidget = new FootnoteDefLabelWidget(num, def.id);
    if (cursorOnLabel) {
      items.push(inlineSourceDecoration.range(def.from, def.labelTo));
    }
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
  (state) => buildSidenoteDecorations(state),
  sidenoteDecorationShouldRebuild,
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

/** ViewPlugin that adds a "Footnotes" section at the end of the document when sidenotes are collapsed. */
class FootnoteSectionPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate): void {
    if (footnoteSectionShouldUpdate(update)) {
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

export { footnoteSectionPlugin };
