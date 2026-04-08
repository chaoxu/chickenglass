import type { EditorState, Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { MathSemantics } from "../semantics/document";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { clearKatexHtmlCache, renderKatexToHtml } from "./inline-shared";
import { mathMacrosField } from "./math-macros";
import { serializeMacros } from "./source-widget";

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

      if (
        macrosKey !== this.lastMacrosKey ||
        prewarmMathRegionsChanged(this.lastRegions, regions)
      ) {
        this.schedulePrewarm(update.state);
      }
    }

    destroy() {
      this.generation++;
    }

    private schedulePrewarm(state: EditorState) {
      this.generation++;
      const generation = this.generation;

      const regions = state.field(documentAnalysisField).mathRegions;
      const macros = state.field(mathMacrosField);

      this.lastRegions = regions;
      this.lastMacrosKey = serializeMacros(macros);

      clearKatexHtmlCache();

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
            renderKatexToHtml(region.latex, region.isDisplay, macros);
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
