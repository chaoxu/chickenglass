/**
 * Hover tooltip for cross-references and citations.
 *
 * When hovering over a [@id] cross-reference, shows a preview of the
 * referenced block content (with KaTeX math rendering). When hovering
 * over a citation, shows the formatted bibliography entry.
 *
 * Uses @floating-ui/dom for positioning and DOM mouseenter/mouseleave
 * events for lifecycle. This replaces CM6's hoverTooltip, which cannot
 * re-invoke when the mouse moves between items within the same widget
 * (same `pos`), causing stale tooltips in clustered crossref widgets (#397).
 */

import { type Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { HOVER_DELAY_MS } from "../constants";
import { blockCounterField } from "../state/block-counter";
import { imageUrlField } from "../state/image-url";
import { mathMacrosField } from "../state/math-macros";
import { pdfPreviewField } from "../state/pdf-preview";
import { documentAnalysisField } from "../state/document-analysis";
import { bibDataField } from "../state/bib-data";
import {
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  localMediaDependenciesChanged,
} from "./media-preview";
import {
  findReferenceWidgetContainer,
  REFERENCE_WIDGET_SELECTOR,
} from "./reference-widget";
import {
  buildTooltipPlanForElement,
  shouldReuseTooltipContent,
} from "./hover-preview-plans";
export {
  buildBlockPreviewBodyForTest,
  buildCrossrefCompletionPreviewContent,
  buildCrossrefPreviewContent,
  normalizeWidePreviewContentForTest,
  refIdFromElement,
  shouldRebuildHoverPreviewContentForTest,
} from "./hover-preview-plans";
import {
  destroyFloatingTooltip,
  floatingTooltipContains,
  hideFloatingTooltip,
  isFloatingTooltipVisible,
  showFloatingTooltip,
  type TooltipPlan,
} from "./hover-tooltip";
export {
  destroyHoverPreviewTooltipForTest,
  ensureHoverPreviewTooltipForTest,
  getCachedTooltipContentForTest,
} from "./hover-tooltip";

let hoverPreviewInstanceCount = 0;

const EMPTY_MEDIA_CACHE: ReadonlyMap<string, unknown> = new Map();
// ── ViewPlugin: event delegation on scrollDOM ───────────────────────────────

/**
 * CM6 ViewPlugin that attaches mouseenter/mouseleave event handlers to
 * the editor's scrollDOM via event delegation. Shows tooltip previews
 * for cross-reference and citation widgets.
 *
 * Each `<span data-ref-id>` within a cluster widget fires its own
 * mouseenter/mouseleave, naturally solving the item-switching bug (#397)
 * that CM6's hoverTooltip could not handle.
 */
const hoverPreviewPlugin = ViewPlugin.define((view) => {
  hoverPreviewInstanceCount += 1;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: HTMLElement | null = null;
  let currentPlan: TooltipPlan | null = null;

  const clearTimer = () => {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const onMouseOver = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target || target === currentTarget) return;

    // Check if the target (or ancestor) is a crossref/citation widget item
    const widgetItem = target.closest("[data-ref-id]") as HTMLElement | null;
    const widgetContainer = findReferenceWidgetContainer(target);

    // Determine the hover anchor: prefer the specific item span for clusters
    const anchor = widgetItem ?? widgetContainer;
    if (!anchor) {
      // Mouse moved off any widget — hide tooltip
      if (currentTarget) {
        clearTimer();
        currentTarget = null;
        currentPlan = null;
        hideFloatingTooltip();
      }
      return;
    }

    // Same anchor — no change needed
    if (anchor === currentTarget) return;

    // Different anchor — start new hover delay
    clearTimer();
    currentTarget = anchor;
    currentPlan = null;
    hideFloatingTooltip();

    hoverTimer = setTimeout(() => {
      // Guard: view must still be connected
      if (!view.dom.ownerDocument) return;

      const plan = buildTooltipPlanForElement(view, anchor);
      if (plan) {
        currentPlan = plan;
        showFloatingTooltip(anchor, plan);
      }
    }, HOVER_DELAY_MS);
  };

  const onMouseOut = (e: Event) => {
    const me = e as MouseEvent;
    const relatedTarget = me.relatedTarget as HTMLElement | null;

    // Check if mouse moved to the tooltip itself — keep it visible
    if (floatingTooltipContains(relatedTarget)) return;

    // Check if mouse moved to another widget item/container
    if (relatedTarget) {
      const stillInWidget = relatedTarget.closest(
        `[data-ref-id], ${REFERENCE_WIDGET_SELECTOR}`,
      );
      if (stillInWidget) return; // onMouseOver will handle the switch
    }

    clearTimer();
    currentTarget = null;
    currentPlan = null;
    hideFloatingTooltip();
  };

  const refreshOpenTooltip = (forceRebuild = false) => {
    if (!currentTarget) return;
    if (!currentTarget.isConnected) {
      currentTarget = null;
      currentPlan = null;
      hideFloatingTooltip();
      return;
    }
    if (!isFloatingTooltipVisible()) return;

    const nextPlan = buildTooltipPlanForElement(view, currentTarget);
    if (!nextPlan) {
      currentPlan = null;
      hideFloatingTooltip();
      return;
    }

    if (shouldReuseTooltipContent(currentPlan, nextPlan, forceRebuild)) {
      currentPlan = nextPlan;
      return;
    }

    currentPlan = nextPlan;
    showFloatingTooltip(currentTarget, nextPlan);
  };

  const scroller = view.scrollDOM;
  scroller.addEventListener("mouseover", onMouseOver);
  scroller.addEventListener("mouseout", onMouseOut);

  return {
    update(update) {
      const beforeAnalysis = update.startState.field(documentAnalysisField, false);
      const afterAnalysis = update.state.field(documentAnalysisField, false);
      const beforeBibData = update.startState.field(bibDataField, false);
      const afterBibData = update.state.field(bibDataField, false);
      const beforeMacros = update.startState.field(mathMacrosField, false);
      const afterMacros = update.state.field(mathMacrosField, false);

      if (!afterAnalysis || !afterBibData) {
        currentTarget = null;
        currentPlan = null;
        hideFloatingTooltip();
        return;
      }

      const localMediaChanged = localMediaDependenciesChanged(
        currentPlan?.mediaDependencies ?? EMPTY_LOCAL_MEDIA_DEPENDENCIES,
        update.startState.field(pdfPreviewField, false) || EMPTY_MEDIA_CACHE,
        update.state.field(pdfPreviewField, false) || EMPTY_MEDIA_CACHE,
        update.startState.field(imageUrlField, false) || EMPTY_MEDIA_CACHE,
        update.state.field(imageUrlField, false) || EMPTY_MEDIA_CACHE,
      );
      const analysisChanged = beforeAnalysis !== afterAnalysis;
      const blockCountersChanged =
        update.startState.field(blockCounterField, false) !== update.state.field(blockCounterField, false);
      const bibliographyChanged = beforeBibData !== afterBibData;
      const macrosChanged = beforeMacros !== afterMacros;
      const forceRebuild =
        (bibliographyChanged && currentPlan?.dependsOnBibliography === true) ||
        (macrosChanged && currentPlan?.dependsOnMacros === true) ||
        localMediaChanged;

      if (
        localMediaChanged ||
        forceRebuild ||
        update.docChanged ||
        analysisChanged ||
        blockCountersChanged
      ) {
        refreshOpenTooltip(forceRebuild);
        return;
      }

      if (currentTarget && !currentTarget.isConnected) {
        currentTarget = null;
        currentPlan = null;
        hideFloatingTooltip();
      }
    },
    destroy() {
      scroller.removeEventListener("mouseover", onMouseOver);
      scroller.removeEventListener("mouseout", onMouseOut);
      clearTimer();
      currentPlan = null;
      hoverPreviewInstanceCount = Math.max(hoverPreviewInstanceCount - 1, 0);
      if (hoverPreviewInstanceCount === 0) {
        destroyFloatingTooltip();
        return;
      }
      hideFloatingTooltip();
    },
  };
});

/**
 * CM6 extension that shows hover previews for cross-references and citations.
 *
 * Uses @floating-ui/dom for tooltip positioning and DOM event delegation
 * (mouseenter/mouseleave) for lifecycle. Each `<span data-ref-id>` in a
 * cluster widget fires its own events, solving the stale-tooltip bug (#397)
 * that CM6's hoverTooltip could not handle (same pos for all items).
 */
export const hoverPreviewExtension: Extension = [
  hoverPreviewPlugin,
];
