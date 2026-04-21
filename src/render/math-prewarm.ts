import type { EditorState, Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { MathSemantics } from "../semantics/document";
import { documentAnalysisField } from "../state/document-analysis";
import { clearKatexHtmlCache, renderKatexToHtml } from "./inline-shared";
import { mathMacrosField } from "../state/math-macros";
import { serializeMacros } from "./source-widget";
import { rangesOverlap } from "../lib/range-helpers";

function scheduleIdle(callback: (deadline?: IdleDeadline) => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback);
  } else {
    setTimeout(() => callback(undefined), 1);
  }
}

/** Maximum time (ms) to spend prewarming per idle chunk when no deadline is available. */
const PREWARM_BUDGET_MS = 2;

function prewarmMathRegionsChanged(
  before: readonly MathSemantics[] | null,
  after: readonly MathSemantics[],
): boolean {
  if (before == null || before.length !== after.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    const previous = before[i];
    const next = after[i];
    if (previous.latex !== next.latex || previous.isDisplay !== next.isDisplay) {
      return true;
    }
  }
  return false;
}

const INLINE_MATH_DELIMITER_RE = /(?:\$|\\\(|\\\)|\\\[|\\\])/;

function docChangeTouchesMathContent(update: ViewUpdate): boolean {
  if (!update.docChanged) return false;

  const beforeRegions = update.startState.field(documentAnalysisField).mathRegions;
  const afterRegions = update.state.field(documentAnalysisField).mathRegions;

  let touched = false;
  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (touched) return;

    const beforeFrom = Math.max(0, fromA - 2);
    const beforeTo = Math.min(update.startState.doc.length, toA + 2);
    const afterFrom = Math.max(0, fromB - 2);
    const afterTo = Math.min(update.state.doc.length, toB + 2);

    if (
      INLINE_MATH_DELIMITER_RE.test(update.startState.sliceDoc(beforeFrom, beforeTo))
      || INLINE_MATH_DELIMITER_RE.test(update.state.sliceDoc(afterFrom, afterTo))
    ) {
      touched = true;
      return;
    }

    for (const region of beforeRegions) {
      if (region.from > toA) break;
      if (rangesOverlap(region, { from: fromA, to: toA })) {
        touched = true;
        return;
      }
    }

    for (const region of afterRegions) {
      if (region.from > toB) break;
      if (rangesOverlap(region, { from: fromB, to: toB })) {
        touched = true;
        return;
      }
    }
  });

  return touched;
}

/**
 * ViewPlugin that pre-populates the KaTeX HTML string cache during idle time.
 */
export const mathPrewarmPlugin: Extension = ViewPlugin.fromClass(
  class {
    private generation = 0;
    private lastRegions: readonly MathSemantics[] | null = null;
    private lastMacrosKey = "";

    constructor(view: EditorView) {
      this.schedulePrewarm(view.state);
    }

    update(update: ViewUpdate) {
      const regions = update.state.field(documentAnalysisField).mathRegions;
      const macros = update.state.field(mathMacrosField);
      const macrosKey = serializeMacros(macros);
      const macrosChanged = macrosKey !== this.lastMacrosKey;
      const mathContentTouched = docChangeTouchesMathContent(update);

      if (
        macrosChanged ||
        (
          (!update.docChanged || mathContentTouched)
          && prewarmMathRegionsChanged(this.lastRegions, regions)
        )
      ) {
        this.schedulePrewarm(update.state, macrosChanged);
      }
    }

    destroy() {
      this.generation++;
    }

    private schedulePrewarm(state: EditorState, clearCache = false) {
      this.generation++;
      const generation = this.generation;

      const regions = state.field(documentAnalysisField).mathRegions;
      const macros = state.field(mathMacrosField);

      this.lastRegions = regions;
      this.lastMacrosKey = serializeMacros(macros);

      if (clearCache) {
        clearKatexHtmlCache();
      }

      if (regions.length === 0) return;

      let index = 0;

      const processChunk = (deadline?: IdleDeadline) => {
        if (this.generation !== generation) return;

        const start = performance.now();
        while (index < regions.length) {
          if (
            deadline
              ? deadline.timeRemaining() < 1
              : performance.now() - start > PREWARM_BUDGET_MS
          ) {
            break;
          }
          const region = regions[index++];
          try {
            renderKatexToHtml(
              region.latex,
              region.isDisplay,
              macros,
              region.isDisplay ? "htmlAndMathml" : "html",
            );
          } catch {
            // KaTeX parse error — skip; the widget will show the error on render.
          }
        }

        if (index < regions.length && this.generation === generation) {
          scheduleIdle(processChunk);
        }
      };

      scheduleIdle(processChunk);
    }
  },
);
