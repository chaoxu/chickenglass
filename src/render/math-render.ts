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
} from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { documentAnalysisField } from "../state/document-analysis";
import {
  getEquationNumbersCacheKey,
  type DocumentAnalysis,
  type MathSemantics,
} from "../semantics/document";
import { mathMouseSelectionStyle } from "./math-interactions";
import { mathMacrosField } from "../state/math-macros";
import { createMathWidgetMetadataPlugin } from "./math-metadata";
import { mathPrewarmPlugin } from "./math-prewarm";
import {
  getInlineMathViewportRanges,
  inlineMathViewportRangesField,
  inlineMathViewportTracker,
  setInlineMathViewportRangesEffect,
} from "./math-inline-viewport";
import {
  buildEquationNumbersByFrom,
  getDisplayEquationNumber,
} from "./math-source";
import { MathWidget } from "./math-widget";
import {
  buildDecorations,
  pushBlockWidgetDecoration,
  pushWidgetDecoration,
} from "./decoration-core";
import { createDecorationStateField } from "./decoration-field";
import { isDebugRenderFlagEnabled } from "./debug-render-flags";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  type DirtyRange,
  dirtyRangesFromChanges,
  expandChangeRange,
  mergeDirtyRanges,
  rangeIntersectsDirtyRanges,
} from "./incremental-dirty-ranges";
import { rangesIntersect } from "../lib/range-helpers";
import { serializeMacros } from "./source-widget";
import { getActiveStructureEditTarget } from "../editor/structure-edit-state";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import { createChangeChecker } from "../state/change-detection";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { planSemanticSensitiveUpdate } from "./view-plugin-factories";
import { rangeIntersectsRanges } from "./viewport-diff";

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

function getExplicitDisplayMathTarget(
  state: EditorState,
): Pick<MathSemantics, "from" | "to"> | undefined {
  const active = getActiveStructureEditTarget(state);
  return active?.kind === "display-math"
    ? { from: active.from, to: active.to }
    : undefined;
}

function getTouchedInlineMathTarget(
  state: EditorState,
  focused: boolean,
): Pick<MathSemantics, "from" | "to"> | null {
  return findFocusedInlineRevealTarget(
    state.selection.main,
    state.field(documentAnalysisField).mathRegions,
    focused,
    (region) => !region.isDisplay,
  );
}

function getRevealedMathTarget(
  state: EditorState,
  focused: boolean,
): Pick<MathSemantics, "from" | "to"> | undefined {
  return getExplicitDisplayMathTarget(state)
    ?? getTouchedInlineMathTarget(state, focused)
    ?? undefined;
}

/**
 * Build decoration ranges for math nodes, skipping nodes where
 * `shouldSkip(from, to)` returns true.
 */
function buildMathItems(
  state: EditorState,
  regions: readonly MathSemantics[],
  shouldSkip: (from: number, to: number) => boolean,
): Range<Decoration>[] {
  const inlineViewportRanges = getInlineMathViewportRanges(state);
  const macros = state.field(mathMacrosField);
  const analysis = state.field(documentAnalysisField);
  const equationNumbersByFrom = buildEquationNumbersByFrom(analysis.equationById);
  const items: Range<Decoration>[] = [];
  const disableInlineMathWidgets = isDebugRenderFlagEnabled("disableInlineMathWidgets");
  const disableDisplayMathWidgets = isDebugRenderFlagEnabled("disableDisplayMathWidgets");

  for (const region of regions) {
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
      if (region.isDisplay && !disableDisplayMathWidgets) {
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

    if (region.isDisplay) {
      if (disableDisplayMathWidgets) continue;
      const widget = new MathWidget(
        region.latex,
        state.sliceDoc(region.from, region.to),
        true,
        macros,
        region.contentFrom - region.from,
        getDisplayEquationNumber(region, equationNumbersByFrom),
      );
      pushBlockWidgetDecoration(items, widget, region.from, region.to);
    } else if (
      !disableInlineMathWidgets
      && rangeIntersectsRanges(region.from, region.to, inlineViewportRanges)
    ) {
      const widget = new MathWidget(
        region.latex,
        state.sliceDoc(region.from, region.to),
        false,
        macros,
        region.contentFrom - region.from,
      );
      pushWidgetDecoration(items, widget, region.from, region.to);
    }
  }

  return items;
}

/**
 * Collect decoration ranges for math nodes outside the current reveal target.
 */
export function collectMathRanges(view: EditorView): Range<Decoration>[] {
  const activeMath = getRevealedMathTarget(view.state, view.hasFocus);
  return buildMathItems(
    view.state,
    view.state.field(documentAnalysisField).mathRegions,
    (from, to) => Boolean(activeMath?.from === from && activeMath?.to === to),
  );
}

function buildMathDecorationsFromState(state: EditorState): DecorationSet {
  const activeMath = getRevealedMathTarget(
    state,
    state.field(editorFocusField, false) ?? false,
  );
  const items = buildMathItems(
    state,
    state.field(documentAnalysisField).mathRegions,
    (from, to) => Boolean(activeMath?.from === from && activeMath?.to === to),
  );
  return buildDecorations(items);
}

function collectDirtyMathRegions(
  regions: readonly MathSemantics[],
  dirtyRanges: readonly DirtyRange[],
): MathSemantics[] {
  if (dirtyRanges.length === 0) return [];
  const dirty: MathSemantics[] = [];
  for (const region of regions) {
    if (rangeIntersectsDirtyRanges(region.from, region.to, dirtyRanges)) {
      dirty.push(region);
    }
  }
  return dirty;
}

function rangeTouchesChange(
  range: Pick<MathSemantics, "from" | "to">,
  change: DirtyRange,
): boolean {
  if (change.from === change.to) {
    return range.from <= change.from && change.from <= range.to;
  }
  return rangesIntersect(range, change);
}

function mapMathRegionDirtyRange(
  region: Pick<MathSemantics, "from" | "to">,
  changes: { mapPos: (pos: number, assoc?: number) => number },
): DirtyRange {
  const from = changes.mapPos(region.from, -1);
  return {
    from,
    to: Math.max(from, changes.mapPos(region.to, 1)),
  };
}

function collectChangedMathDirtyRanges(
  tr: Transaction,
  regionsBefore: readonly MathSemantics[],
  regionsAfter: readonly MathSemantics[],
): DirtyRange[] {
  const dirtyRanges: DirtyRange[] = [];

  tr.changes.iterChangedRanges((fromOld, toOld, fromNew, toNew) => {
    const oldChange = { from: fromOld, to: Math.max(fromOld, toOld) };
    const newChange = { from: fromNew, to: Math.max(fromNew, toNew) };

    for (const region of regionsBefore) {
      if (!rangeTouchesChange(region, oldChange)) continue;
      dirtyRanges.push(mapMathRegionDirtyRange(region, tr.changes));
    }

    for (const region of regionsAfter) {
      if (!rangeTouchesChange(region, newChange)) continue;
      dirtyRanges.push({ from: region.from, to: region.to });
    }
  }, true);

  return mergeDirtyRanges(dirtyRanges);
}

function docChangeCanShiftMathDecorations(
  tr: Transaction,
  regionsBefore: readonly MathSemantics[],
): boolean {
  if (!tr.docChanged || regionsBefore.length === 0) return false;
  let lastMathTo = 0;
  for (const region of regionsBefore) {
    lastMathTo = Math.max(lastMathTo, region.to);
  }

  let canShift = false;
  tr.changes.iterChangedRanges((fromOld) => {
    if (fromOld <= lastMathTo) {
      canShift = true;
    }
  });
  return canShift;
}

function sameViewportRanges(
  before: readonly { from: number; to: number }[],
  after: readonly { from: number; to: number }[],
): boolean {
  if (before === after) return true;
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index].from !== after[index].from || before[index].to !== after[index].to) {
      return false;
    }
  }
  return true;
}

function collectInlineViewportDirtyRanges(
  regions: readonly MathSemantics[],
  beforeRanges: readonly { from: number; to: number }[],
  afterRanges: readonly { from: number; to: number }[],
): DirtyRange[] {
  const dirtyRanges: DirtyRange[] = [];
  for (const region of regions) {
    if (region.isDisplay) continue;
    const wasVisible = rangeIntersectsRanges(region.from, region.to, beforeRanges);
    const isVisible = rangeIntersectsRanges(region.from, region.to, afterRanges);
    if (wasVisible !== isVisible) {
      dirtyRanges.push({ from: region.from, to: region.to });
    }
  }
  return mergeDirtyRanges(dirtyRanges);
}

function equationNumberingChanged(
  before: DocumentAnalysis,
  after: DocumentAnalysis,
): boolean {
  return before.equations !== after.equations
    && getEquationNumbersCacheKey(before) !== getEquationNumbersCacheKey(after);
}

function buildMathRangesForRegions(
  state: EditorState,
  regions: readonly MathSemantics[],
): Range<Decoration>[] {
  const activeMath = getRevealedMathTarget(
    state,
    state.field(editorFocusField, false) ?? false,
  );
  return buildMathItems(
    state,
    regions,
    (from, to) => Boolean(activeMath?.from === from && activeMath?.to === to),
  );
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
  return buildMathDecorationsFromState(state);
}

/**
 * CM6 StateField that provides math rendering decorations.
 *
 * Uses a StateField so that block-level replace decorations for display math
 * are permitted by CM6.
 */
const mathDecorationField = createDecorationStateField({
  create(state) {
    return rebuildMathDecorations(state);
  },

  update(value, tr) {
    const analysisBefore = tr.startState.field(documentAnalysisField);
    const analysisAfter = tr.state.field(documentAnalysisField);
    const regionsBefore = analysisBefore.mathRegions;
    const regionsAfter = analysisAfter.mathRegions;
    const beforeActive = getRevealedMathTarget(
      tr.startState,
      tr.startState.field(editorFocusField, false) ?? false,
    );
    const afterActive = getRevealedMathTarget(
      tr.state,
      tr.state.field(editorFocusField, false) ?? false,
    );
    const activeMathChanged = inlineRevealTargetChanged(beforeActive, afterActive);
    const beforeInlineViewport = getInlineMathViewportRanges(tr.startState);
    const afterInlineViewport = getInlineMathViewportRanges(tr.state);
    const inlineViewportChanged =
      tr.effects.some((effect) => effect.is(setInlineMathViewportRangesEffect))
      && !sameViewportRanges(beforeInlineViewport, afterInlineViewport);
    const mathPositionsMayShift = docChangeCanShiftMathDecorations(tr, regionsBefore);

    const updatePlan = planSemanticSensitiveUpdate(tr, {
      docChanged: (transaction) => transaction.docChanged,
      semanticChanged: () => regionsBefore !== regionsAfter || mathPositionsMayShift,
      contextChanged: () => inlineViewportChanged,
      contextUpdateMode: "dirty-ranges",
      // Edits after every math range cannot shift math decorations, so keep the
      // DecorationSet stable for that common path.
      stableDocChangeMode: "keep",
      shouldRebuild: (_transaction, context) => {
        if (tr.annotation(programmaticDocumentChangeAnnotation) === true) {
          return true;
        }
        if (mathMacrosChanged(tr) || activeMathChanged) {
          return true;
        }
        if (
          context.docChanged
          && context.semanticChanged
          && regionsBefore.length !== regionsAfter.length
        ) {
          return true;
        }
        return context.docChanged
          && context.semanticChanged
          && equationNumberingChanged(analysisBefore, analysisAfter);
      },
      dirtyRanges: (_transaction, context) => {
        if (!context.docChanged && inlineViewportChanged) {
          return collectInlineViewportDirtyRanges(
            regionsAfter,
            beforeInlineViewport,
            afterInlineViewport,
          );
        }

        if (!context.docChanged || !context.semanticChanged) {
          return [];
        }

        const equationNumbersBefore = buildEquationNumbersByFrom(analysisBefore.equationById);
        const equationNumbersAfter = buildEquationNumbersByFrom(analysisAfter.equationById);
        if (
          mathContentUnchanged(
            regionsBefore,
            regionsAfter,
            equationNumbersBefore,
            equationNumbersAfter,
          )
        ) {
          return [];
        }

        return mergeDirtyRanges([
          ...dirtyRangesFromChanges(tr.changes, expandChangeRange),
          ...collectChangedMathDirtyRanges(tr, regionsBefore, regionsAfter),
        ]);
      },
    });

    switch (updatePlan.kind) {
      case "keep":
        return value;
      case "map":
        return value.map(tr.changes);
      case "rebuild":
        return rebuildMathDecorations(tr.state);
      case "dirty": {
        const mapped = value.map(tr.changes);
        const dirtyRegions = collectDirtyMathRegions(regionsAfter, updatePlan.dirtyRanges);
        let next = mapped;
        for (const range of updatePlan.dirtyRanges) {
          next = next.update({
            filterFrom: range.from,
            filterTo: range.to,
            filter: (from, to) => !rangeIntersectsDirtyRanges(from, to, [range]),
          });
        }
        if (dirtyRegions.length > 0) {
          next = next.update({
            add: buildMathRangesForRegions(tr.state, dirtyRegions),
            sort: true,
          });
        }
        return next;
      }
    }
  },
});

export { mathDecorationField as _mathDecorationFieldForTest };

const mathWidgetMetadataPlugin = createMathWidgetMetadataPlugin(mathDecorationField);

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mathMacrosField,
  inlineMathViewportRangesField,
  mathDecorationField,
  mathMouseSelectionStyle,
  mathWidgetMetadataPlugin,
  mathPrewarmPlugin,
  inlineMathViewportTracker,
];
