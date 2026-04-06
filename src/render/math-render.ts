import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { documentAnalysisField } from "../semantics/codemirror-source";
import type { MathSemantics } from "../semantics/document";
import { mathMouseSelectionStyle } from "./math-interactions";
import { mathMacrosField } from "./math-macros";
import { createMathWidgetMetadataPlugin } from "./math-metadata";
import { mathPrewarmPlugin } from "./math-prewarm";
import {
  buildEquationNumbersByFrom,
  findActiveMath,
  getDisplayEquationNumber,
} from "./math-source";
import { MathWidget } from "./math-widget";
import {
  buildDecorations,
  cursorInRange,
  editorFocusField,
  focusEffect,
  focusTracker,
  pushWidgetDecoration,
  serializeMacros,
} from "./render-utils";

export { renderKatexToHtml } from "./inline-shared";
export {
  DISPLAY_DELIMITERS,
  INLINE_DELIMITERS,
  MATH_TYPES,
  _snapToTokenBoundary,
  getDisplayMathContentEnd,
  stripMathDelimiters,
} from "./math-source";
export { resolveClickToSourcePos } from "./math-interactions";
export { clearKatexCache, MathWidget, renderKatex } from "./math-widget";
export { findActiveMath } from "./math-source";

function mathMacrosChanged(tr: Transaction): boolean {
  const before = tr.startState.field(mathMacrosField, false) ?? {};
  const after = tr.state.field(mathMacrosField, false) ?? {};
  return before !== after && serializeMacros(before) !== serializeMacros(after);
}

function findFocusedActiveMath(state: EditorState): MathSemantics | undefined {
  const focused = state.field(editorFocusField, false) ?? false;
  return focused
    ? findActiveMath(state.field(documentAnalysisField).mathRegions, state.selection.main)
    : undefined;
}

/**
 * Build decoration ranges for math nodes, skipping nodes where
 * `shouldSkip(from, to)` returns true.
 */
function buildMathItems(
  state: EditorState,
  shouldSkip: (from: number, to: number) => boolean,
): Range<Decoration>[] {
  const macros = state.field(mathMacrosField);
  const analysis = state.field(documentAnalysisField);
  const equationNumbersByFrom = buildEquationNumbersByFrom(analysis.equationById);
  const items: Range<Decoration>[] = [];

  for (const region of analysis.mathRegions) {
    if (shouldSkip(region.from, region.to)) {
      if (region.contentFrom > region.from) {
        // Keep delimiters on the lighter source-delimiter class so they
        // do not make the edited math line taller than the body content. (#789)
        items.push(
          Decoration.mark({ class: CSS.sourceDelimiter }).range(region.from, region.contentFrom),
        );
      }
      if (region.contentFrom < region.contentTo) {
        items.push(
          Decoration.mark({ class: CSS.mathSource }).range(region.contentFrom, region.contentTo),
        );
      }
      const closingDelimiterStart = region.isDisplay && region.labelFrom !== undefined
        ? region.labelFrom
        : region.to;
      if (closingDelimiterStart > region.contentTo) {
        items.push(
          Decoration.mark({ class: CSS.sourceDelimiter }).range(
            region.contentTo,
            closingDelimiterStart,
          ),
        );
      }
      if (region.isDisplay && region.labelFrom !== undefined && region.to > region.labelFrom) {
        items.push(
          Decoration.mark({ class: CSS.mathSource }).range(region.labelFrom, region.to),
        );
      }
      if (region.isDisplay) {
        // Display math stays rendered even while showing source marks so the
        // block height and click target remain stable during cursor reveal.
        const widget = new MathWidget(
          region.latex,
          state.sliceDoc(region.from, region.to),
          true,
          macros,
          region.contentFrom - region.from,
          getDisplayEquationNumber(region, equationNumbersByFrom),
        );
        widget.sourceFrom = region.from;
        widget.sourceTo = region.to;
        items.push(Decoration.widget({ widget, block: true, side: 1 }).range(region.to));
      }
      continue;
    }

    pushWidgetDecoration(
      items,
      new MathWidget(
        region.latex,
        state.sliceDoc(region.from, region.to),
        region.isDisplay,
        macros,
        region.contentFrom - region.from,
        getDisplayEquationNumber(region, equationNumbersByFrom),
      ),
      region.from,
      region.to,
    );
  }

  return items;
}

/**
 * Collect decoration ranges for math nodes outside the cursor.
 */
export function collectMathRanges(view: EditorView): Range<Decoration>[] {
  return buildMathItems(view.state, (from, to) => cursorInRange(view, from, to));
}

function buildMathDecorationsFromState(state: EditorState, focused: boolean): DecorationSet {
  const items = buildMathItems(
    state,
    (from, to) => focused && cursorInRange(state, from, to),
  );
  return buildDecorations(items);
}

function mathContentUnchanged(
  before: readonly MathSemantics[],
  after: readonly MathSemantics[],
  beforeEquationNumbersByFrom: ReadonlyMap<number, number>,
  afterEquationNumbersByFrom: ReadonlyMap<number, number>,
): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    const prev = before[i];
    const next = after[i];
    if (
      prev.latex !== next.latex
      || prev.isDisplay !== next.isDisplay
      || (prev.to - prev.from) !== (next.to - next.from)
      || getDisplayEquationNumber(prev, beforeEquationNumbersByFrom)
        !== getDisplayEquationNumber(next, afterEquationNumbersByFrom)
    ) {
      return false;
    }
  }
  return true;
}

function rebuildMathDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  return buildMathDecorationsFromState(state, focused);
}

/**
 * CM6 StateField that provides math rendering decorations.
 *
 * Uses a StateField so that block-level replace decorations for display math
 * are permitted by CM6.
 */
const mathDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return rebuildMathDecorations(state);
  },

  update(value, tr) {
    if (mathMacrosChanged(tr)) {
      return rebuildMathDecorations(tr.state);
    }

    const analysisBefore = tr.startState.field(documentAnalysisField);
    const analysisAfter = tr.state.field(documentAnalysisField);
    const regionsBefore = analysisBefore.mathRegions;
    const regionsAfter = analysisAfter.mathRegions;
    const equationNumbersBefore = buildEquationNumbersByFrom(analysisBefore.equationById);
    const equationNumbersAfter = buildEquationNumbersByFrom(analysisAfter.equationById);

    if (regionsBefore !== regionsAfter) {
      if (
        tr.docChanged
        && tr.selection === undefined
        && !tr.effects.some((effect) => effect.is(focusEffect))
        && mathContentUnchanged(
          regionsBefore,
          regionsAfter,
          equationNumbersBefore,
          equationNumbersAfter,
        )
      ) {
        const mapped = value.map(tr.changes);
        const cursor = mapped.iter();
        while (cursor.value) {
          const widget = cursor.value.spec?.widget;
          if (widget instanceof MathWidget) {
            widget.updateSourceRange(cursor.from, cursor.to);
          }
          cursor.next();
        }
        return mapped;
      }
      return rebuildMathDecorations(tr.state);
    }

    const focusChanged = tr.effects.some((effect) => effect.is(focusEffect));
    if (tr.selection === undefined && !focusChanged) return value;

    const before = findFocusedActiveMath(tr.startState);
    const after = findFocusedActiveMath(tr.state);
    if (before?.from !== after?.from || before?.to !== after?.to) {
      return rebuildMathDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export { mathDecorationField as _mathDecorationFieldForTest };

const mathWidgetMetadataPlugin = createMathWidgetMetadataPlugin(mathDecorationField);

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mathMacrosField,
  mathDecorationField,
  mathMouseSelectionStyle,
  mathWidgetMetadataPlugin,
  mathPrewarmPlugin,
];
