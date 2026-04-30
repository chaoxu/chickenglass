import {
  type EditorState,
  type Extension,
  type Range,
  type Text,
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
import { serializeMacros } from "./source-widget";
import { getActiveStructureEditTarget } from "../state/cm-structure-edit";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import { createChangeChecker } from "../state/change-detection";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { planSemanticSensitiveUpdate } from "./view-plugin-factories";
import { measureSync } from "../lib/perf";

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
    } else if (!disableInlineMathWidgets) {
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
  let lastDirtyRegion: MathSemantics | undefined;
  for (const range of dirtyRanges) {
    forEachMathRegionIntersectingRange(regions, range, (region) => {
      if (region === lastDirtyRegion) return;
      dirty.push(region);
      lastDirtyRegion = region;
    });
  }
  return dirty;
}

function firstMathRegionWithToAfter(
  regions: readonly MathSemantics[],
  pos: number,
): number {
  let low = 0;
  let high = regions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (regions[mid].to <= pos) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function firstMathRegionWithToAtLeast(
  regions: readonly MathSemantics[],
  pos: number,
): number {
  let low = 0;
  let high = regions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (regions[mid].to < pos) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function forEachMathRegionIntersectingRange(
  regions: readonly MathSemantics[],
  range: DirtyRange,
  visit: (region: MathSemantics) => void,
): void {
  if (range.from === range.to) return;
  const startIndex = firstMathRegionWithToAfter(regions, range.from);
  for (let index = startIndex; index < regions.length; index += 1) {
    const region = regions[index];
    if (region.from >= range.to) break;
    visit(region);
  }
}

function forEachMathRegionTouchingChange(
  regions: readonly MathSemantics[],
  change: DirtyRange,
  visit: (region: MathSemantics) => void,
): void {
  if (change.from === change.to) {
    const startIndex = firstMathRegionWithToAtLeast(regions, change.from);
    for (let index = startIndex; index < regions.length; index += 1) {
      const region = regions[index];
      if (region.from > change.from) break;
      visit(region);
    }
    return;
  }

  forEachMathRegionIntersectingRange(regions, change, visit);
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

interface MathChangeSummary {
  readonly changedMathDirtyRanges: readonly DirtyRange[];
  readonly hasMathSyntaxEdit: boolean;
  readonly touchesExistingMath: boolean;
}

function containsMathSyntaxEdit(text: string): boolean {
  return /[$\\()[\]{}#\r\n]/.test(text);
}

function textContainsMathSyntaxEdit(text: Text): boolean {
  const cursor = text.iter();
  while (!cursor.next().done) {
    if (containsMathSyntaxEdit(cursor.value)) {
      return true;
    }
  }
  return false;
}

function sliceChangeContext(
  state: EditorState,
  from: number,
  to: number,
): string {
  return state.sliceDoc(
    Math.max(0, from - 1),
    Math.min(state.doc.length, Math.max(from, to) + 1),
  );
}

function summarizeMathChanges(
  tr: Transaction,
  regionsBefore: readonly MathSemantics[],
  regionsAfter: readonly MathSemantics[],
): MathChangeSummary {
  const dirtyRanges: DirtyRange[] = [];
  let hasMathSyntaxEdit = false;
  let touchesExistingMath = false;

  tr.changes.iterChanges((fromOld, toOld, fromNew, toNew, inserted) => {
    if (
      !hasMathSyntaxEdit
      && (
        textContainsMathSyntaxEdit(inserted)
        || containsMathSyntaxEdit(sliceChangeContext(tr.startState, fromOld, toOld))
        || containsMathSyntaxEdit(sliceChangeContext(tr.state, fromNew, toNew))
      )
    ) {
      hasMathSyntaxEdit = true;
    }

    const oldChange = { from: fromOld, to: Math.max(fromOld, toOld) };
    const newChange = { from: fromNew, to: Math.max(fromNew, toNew) };

    forEachMathRegionTouchingChange(regionsBefore, oldChange, (region) => {
      touchesExistingMath = true;
      dirtyRanges.push(mapMathRegionDirtyRange(region, tr.changes));
    });

    forEachMathRegionTouchingChange(regionsAfter, newChange, (region) => {
      dirtyRanges.push({ from: region.from, to: region.to });
    });
  }, true);

  return {
    changedMathDirtyRanges: mergeDirtyRanges(dirtyRanges),
    hasMathSyntaxEdit,
    touchesExistingMath,
  };
}

function docChangeCanShiftMathDecorations(
  tr: Transaction,
  regionsBefore: readonly MathSemantics[],
): boolean {
  if (!tr.docChanged || regionsBefore.length === 0) return false;
  const lastMathTo = regionsBefore[regionsBefore.length - 1].to;

  let canShift = false;
  tr.changes.iterChangedRanges((fromOld) => {
    if (fromOld <= lastMathTo) {
      canShift = true;
    }
  });
  return canShift;
}

function docChangeCanShiftDecorationSet(
  decorations: DecorationSet,
  tr: Transaction,
): boolean {
  let maxTo = -1;
  const cursor = decorations.iter();
  while (cursor.value) {
    maxTo = Math.max(maxTo, cursor.to);
    cursor.next();
  }
  if (maxTo < 0) return false;
  if (maxTo > tr.state.doc.length) return true;

  let canShift = false;
  tr.changes.iterChangedRanges((fromOld) => {
    if (fromOld <= maxTo) {
      canShift = true;
    }
  });
  return canShift;
}


function collectActiveMathDirtyRanges(
  tr: Transaction,
  activeChanged: boolean,
  beforeActive: Pick<MathSemantics, "from" | "to"> | null | undefined,
  afterActive: Pick<MathSemantics, "from" | "to"> | null | undefined,
): DirtyRange[] {
  if (!activeChanged) return [];

  const ranges: DirtyRange[] = [];
  if (beforeActive) {
    ranges.push(tr.docChanged ? mapMathRegionDirtyRange(beforeActive, tr.changes) : beforeActive);
  }
  if (afterActive) {
    ranges.push(afterActive);
  }
  return mergeDirtyRanges(ranges);
}

function decorationIntersectsMathDirtyRanges(
  from: number,
  to: number,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  if (rangeIntersectsDirtyRanges(from, to, dirtyRanges)) {
    return true;
  }
  if (from !== to) {
    return false;
  }
  return dirtyRanges.some((range) => from === range.to);
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
  spanName: "cm6.mathDecorations",
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
    const mathPositionsMayShift = docChangeCanShiftMathDecorations(tr, regionsBefore);
    const mathChangeSummary = tr.docChanged
      ? summarizeMathChanges(tr, regionsBefore, regionsAfter)
      : {
          changedMathDirtyRanges: [],
          hasMathSyntaxEdit: false,
          touchesExistingMath: false,
        };
    const docChangeOnlyShiftsMath =
      tr.docChanged
      && !mathChangeSummary.hasMathSyntaxEdit
      && !mathChangeSummary.touchesExistingMath;

    const updatePlan = planSemanticSensitiveUpdate(tr, {
      docChanged: (transaction) => transaction.docChanged,
      semanticChanged: () => {
        if (docChangeOnlyShiftsMath && !mathPositionsMayShift) return false;
        return regionsBefore !== regionsAfter || mathPositionsMayShift;
      },
      contextChanged: () => activeMathChanged,
      contextUpdateMode: "dirty-ranges",
      // Edits after every math range can keep the DecorationSet by identity.
      // The "keep" branch below still maps when the actual decoration set
      // would shift or exceed the new document bounds.
      stableDocChangeMode: "keep",
      shouldRebuild: (_transaction, context) => {
        if (tr.annotation(programmaticDocumentChangeAnnotation) === true) {
          return true;
        }
        if (mathMacrosChanged(tr)) {
          return true;
        }
        if (docChangeOnlyShiftsMath) {
          return false;
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
        const activeDirtyRanges = collectActiveMathDirtyRanges(
          tr,
          activeMathChanged,
          beforeActive,
          afterActive,
        );

        if (!context.docChanged) {
          return activeDirtyRanges;
        }

        if (!context.docChanged || !context.semanticChanged) {
          return activeDirtyRanges;
        }

        const mathDirtyRanges =
          docChangeOnlyShiftsMath || mathChangeSummary.changedMathDirtyRanges.length === 0
            ? []
            : [
              ...dirtyRangesFromChanges(tr.changes, expandChangeRange),
              ...mathChangeSummary.changedMathDirtyRanges,
            ];
        return mergeDirtyRanges([
          ...mathDirtyRanges,
          ...activeDirtyRanges,
        ]);
      },
    });

    switch (updatePlan.kind) {
      case "keep":
        return measureSync("cm6.mathDecorations.keep", () =>
          tr.docChanged && docChangeCanShiftDecorationSet(value, tr)
            ? value.map(tr.changes)
            : value
        );
      case "map":
        return measureSync("cm6.mathDecorations.map", () => value.map(tr.changes));
      case "rebuild":
        return measureSync(
          "cm6.mathDecorations.rebuild",
          () => rebuildMathDecorations(tr.state),
        );
      case "dirty": {
        return measureSync("cm6.mathDecorations.dirty", () => {
          const mapped = value.map(tr.changes);
          const dirtyRegions = collectDirtyMathRegions(regionsAfter, updatePlan.dirtyRanges);
          let next = mapped;
          for (const range of updatePlan.dirtyRanges) {
            next = next.update({
              filterFrom: range.from,
              filterTo: range.to,
              filter: (from, to) => !decorationIntersectsMathDirtyRanges(from, to, [range]),
            });
          }
          if (dirtyRegions.length > 0) {
            next = next.update({
              add: buildMathRangesForRegions(tr.state, dirtyRegions),
              sort: true,
            });
          }
          return next;
        });
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
  mathDecorationField,
  mathMouseSelectionStyle,
  mathWidgetMetadataPlugin,
  mathPrewarmPlugin,
];
