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
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
import {
  type ResolvedCrossref,
  resolveCrossref,
} from "../index/crossref-resolver";
import type { ReferenceSemantics } from "../semantics/document";
import { blockCounterField, type NumberedBlock } from "../plugins";
import { bibDataField, type BibStore } from "../citations/citation-render";
import { formatBibEntry } from "../citations/bibliography";
import { renderKatex } from "./math-render";
import { mathMacrosField } from "./math-macros";
import { renderBlockContentToDom, renderDocumentFragmentToDom, type BlockContentOptions } from "../document-surfaces";
import { getPlugin, pluginRegistryField } from "../plugins";
import type { BlockCounterEntry } from "../app/markdown-to-html";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { HOVER_DELAY_MS } from "../constants";

// ── Singleton tooltip element ───────────────────────────────────────────────

let tooltipEl: HTMLDivElement | null = null;

function getTooltipEl(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "cf-hover-preview-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

/**
 * Position and show the singleton tooltip near an anchor element using
 * @floating-ui/dom's `computePosition` with flip+shift middleware.
 */
function showFloatingTooltip(anchor: HTMLElement, content: HTMLElement): void {
  const el = getTooltipEl();
  el.innerHTML = "";
  el.appendChild(content);
  el.style.display = "";
  el.setAttribute("data-visible", "false");

  void computePosition(anchor, el, {
    placement: "top",
    middleware: [offset(6), flip(), shift({ padding: 5 })],
  }).then(({ x, y }) => {
    Object.assign(el.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
    // Trigger enter animation after positioning
    requestAnimationFrame(() => {
      el.setAttribute("data-visible", "true");
    });
  });
}

/** Hide and clear the singleton tooltip. */
function hideFloatingTooltip(): void {
  if (tooltipEl) {
    tooltipEl.setAttribute("data-visible", "false");
    tooltipEl.style.display = "none";
    tooltipEl.innerHTML = "";
  }
}

// ── Content extraction helpers ──────────────────────────────────────────────

/**
 * Extract the content of a fenced div block for the given NumberedBlock.
 * Returns the inner content (between opening/closing fences) as plain text.
 */
function extractBlockContent(
  view: EditorView,
  block: NumberedBlock,
): string {
  const div = view.state.field(documentAnalysisField).fencedDivByFrom.get(block.from);

  let contentFrom = block.from;
  let contentTo = block.to;

  if (div) {
    contentFrom = view.state.doc.lineAt(div.openFenceTo).to + 1;
    if (div.closeFenceFrom >= 0) {
      contentTo = div.closeFenceFrom;
    }
  }

  contentFrom = Math.min(contentFrom, view.state.doc.length);
  contentTo = Math.min(contentTo, view.state.doc.length);
  if (contentFrom >= contentTo) return "";

  return view.state.doc.sliceString(contentFrom, contentTo).trim();
}

/** Create a header div for the tooltip. */
function createHeader(
  text: string,
  macros: Record<string, string> = {},
  extraClass?: string,
): HTMLElement {
  const header = document.createElement("div");
  header.className = extraClass
    ? `cf-hover-preview-header ${extraClass}`
    : "cf-hover-preview-header";
  renderDocumentFragmentToDom(header, {
    kind: "title",
    text,
    macros,
  });
  return header;
}

/**
 * Find the LaTeX source for an equation by its label id.
 * Scans the syntax tree for EquationLabel nodes and extracts the
 * parent DisplayMath content.
 */
function findEquationSource(view: EditorView, id: string): string | undefined {
  const equation = view.state.field(documentAnalysisField).equationById.get(id);
  if (!equation) return undefined;
  return equation.latex.trim();
}

// ── Tooltip content builders ────────────────────────────────────────────────

/**
 * Build BlockContentOptions from the current CM6 state.
 *
 * Extracts bibliography, CSL processor, and block counters so that
 * `renderBlockContentToDom` can resolve citations and cross-references
 * inside hover preview bodies (e.g. `[@cormen2009]` or `[@thm:foo]`
 * within a theorem body).
 */
function buildBlockContentOptions(view: EditorView, macros: Record<string, string>): BlockContentOptions {
  const { store, cslProcessor } = view.state.field(bibDataField);
  const counterState = view.state.field(blockCounterField, false);
  const registry = view.state.field(pluginRegistryField, false);

  // Build plain-data block counter map from CM6 state
  let blockCounters: Map<string, BlockCounterEntry> | undefined;
  if (counterState) {
    blockCounters = new Map<string, BlockCounterEntry>();
    for (const block of counterState.blocks) {
      if (block.id) {
        const plugin = registry ? getPlugin(registry, block.type) : undefined;
        blockCounters.set(block.id, {
          type: block.type,
          title: plugin?.title ?? block.type,
          number: block.number,
        });
      }
    }
  }

  return {
    macros,
    bibliography: store.size > 0 ? store : undefined,
    cslProcessor: store.size > 0 ? cslProcessor : undefined,
    blockCounters,
  };
}

/**
 * Append the preview content for a single cross-reference id to a container.
 * Reused by both single-id and clustered tooltip builders.
 */
function appendCrossrefItem(
  container: HTMLElement,
  view: EditorView,
  id: string,
  resolved: ResolvedCrossref,
  macros: Record<string, string>,
): void {
  if (resolved.kind === "block") {
    container.appendChild(createHeader(resolved.label, macros));

    const counterState = view.state.field(blockCounterField, false);
    const block = counterState?.byId.get(id);
    if (block) {
      const content = extractBlockContent(view, block);
      if (content) {
        const body = document.createElement("div");
        body.className = "cf-hover-preview-body";
        renderBlockContentToDom(body, content, buildBlockContentOptions(view, macros));
        container.appendChild(body);
      }
    }
  } else if (resolved.kind === "equation") {
    container.appendChild(createHeader(resolved.label, macros));

    const eqContent = findEquationSource(view, id);
    if (eqContent) {
      const body = document.createElement("div");
      body.className = "cf-hover-preview-body";
      renderKatex(body, eqContent, true, macros);
      container.appendChild(body);
    }
  } else {
    container.appendChild(
      createHeader(`Unresolved: ${id}`, macros, "cf-hover-preview-unresolved"),
    );
  }
}

/**
 * Build the tooltip DOM for a cross-reference hover preview.
 * Accepts pre-resolved data to avoid redundant resolution.
 */
function buildCrossrefTooltip(
  view: EditorView,
  ref: ReferenceSemantics,
  resolved: ResolvedCrossref,
): HTMLElement {
  const macros = view.state.field(mathMacrosField);
  const container = document.createElement("div");
  container.className = "cf-hover-preview";
  appendCrossrefItem(container, view, ref.ids[0], resolved, macros);
  return container;
}

/**
 * Build the tooltip DOM for a citation hover preview.
 */
function buildCitationTooltip(
  ids: readonly string[],
  store: BibStore,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "cf-hover-preview";

  for (const id of ids) {
    const entry = store.get(id);
    if (!entry) continue;

    const item = document.createElement("div");
    item.className = "cf-hover-preview-citation";
    item.textContent = formatBibEntry(entry);
    container.appendChild(item);
  }

  if (container.children.length === 0) {
    container.appendChild(
      createHeader(`Unknown citation: ${ids.join(", ")}`, {}, "cf-hover-preview-unresolved"),
    );
  }

  return container;
}

/**
 * Build a single-item tooltip for a specific id within a cluster.
 */
function buildSingleItemTooltip(
  view: EditorView,
  id: string,
  resolved: ResolvedCrossref,
  store: BibStore,
): HTMLElement {
  const macros = view.state.field(mathMacrosField);
  const container = document.createElement("div");
  container.className = "cf-hover-preview";

  if (resolved.kind === "citation") {
    const entry = store.get(id);
    if (entry) {
      const item = document.createElement("div");
      item.className = "cf-hover-preview-citation";
      item.textContent = formatBibEntry(entry);
      container.appendChild(item);
    } else {
      container.appendChild(
        createHeader(`Unknown: @${id}`, macros, "cf-hover-preview-unresolved"),
      );
    }
  } else {
    appendCrossrefItem(container, view, id, resolved, macros);
  }

  return container;
}

// ── DOM walk helper ─────────────────────────────────────────────────────────

/**
 * Walk up from a DOM element to find the nearest ancestor (or self) with
 * a `data-ref-id` attribute. Returns the attribute value or null.
 *
 * Exported for testing: the DOM walk is the core logic that enables
 * per-item targeting, and can be tested without `elementFromPoint`.
 */
export function refIdFromElement(el: Element | null): string | null {
  let node: Element | null = el;
  while (node) {
    if (node.hasAttribute("data-ref-id")) {
      return node.getAttribute("data-ref-id");
    }
    node = node.parentElement;
  }
  return null;
}

// ── Hover logic: determine what to show ─────────────────────────────────────

/**
 * Find the ReferenceSemantics at a given document position.
 */
function findRefAt(view: EditorView, pos: number): ReferenceSemantics | undefined {
  const analysis = view.state.field(documentAnalysisField);
  return analysis.references.find((r) => pos >= r.from && pos <= r.to);
}

/**
 * Determine tooltip content for a hovered element that belongs to a
 * cross-reference or citation widget.
 *
 * Returns the tooltip content element, or null if no tooltip should show
 * (e.g., hovering on a separator text node).
 */
function buildTooltipForElement(
  view: EditorView,
  target: HTMLElement,
): HTMLElement | null {
  const analysis = view.state.field(documentAnalysisField);
  const equationLabels = analysis.equationById;

  // Check if we're hovering a data-ref-id span (cluster item)
  const refId = refIdFromElement(target);

  // Find the widget container to determine if this is crossref or citation
  const widgetEl = target.closest(".cf-crossref, .cf-citation");
  if (!widgetEl) return null;

  // Find the CM6 widget position — walk up to find the cm-widgetBuffer sibling
  // or the widget wrapper, then use view.posAtDOM
  let pos: number;
  try {
    pos = view.posAtDOM(widgetEl);
  } catch {
    return null;
  }

  const ref = findRefAt(view, pos);
  if (!ref) return null;

  const resolutions = ref.ids.map((id) =>
    resolveCrossref(view.state, id, equationLabels),
  );
  const hasCrossref = resolutions.some((r) => r.kind !== "citation");

  // Single-id crossref
  if (ref.ids.length === 1 && hasCrossref) {
    return buildCrossrefTooltip(view, ref, resolutions[0]);
  }

  // Multi-id cluster — per-item targeting via data-ref-id
  if (ref.ids.length > 1 && hasCrossref) {
    if (!refId) return null; // Hovering on separator — no tooltip
    const itemIndex = ref.ids.indexOf(refId);
    if (itemIndex < 0) return null;
    const { store } = view.state.field(bibDataField);
    return buildSingleItemTooltip(view, refId, resolutions[itemIndex], store);
  }

  // Pure citation cluster
  const { store } = view.state.field(bibDataField);
  if (store.size > 0 && ref.ids.some((id) => store.has(id))) {
    // If we have a specific ref-id in the cluster, show single item
    if (refId && ref.ids.includes(refId)) {
      const itemIndex = ref.ids.indexOf(refId);
      return buildSingleItemTooltip(view, refId, resolutions[itemIndex], store);
    }
    return buildCitationTooltip(ref.ids, store);
  }

  return null;
}

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
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: HTMLElement | null = null;

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
    const widgetContainer = target.closest(".cf-crossref, .cf-citation") as HTMLElement | null;

    // Determine the hover anchor: prefer the specific item span for clusters
    const anchor = widgetItem ?? widgetContainer;
    if (!anchor) {
      // Mouse moved off any widget — hide tooltip
      if (currentTarget) {
        clearTimer();
        currentTarget = null;
        hideFloatingTooltip();
      }
      return;
    }

    // Same anchor — no change needed
    if (anchor === currentTarget) return;

    // Different anchor — start new hover delay
    clearTimer();
    currentTarget = anchor;
    hideFloatingTooltip();

    hoverTimer = setTimeout(() => {
      // Guard: view must still be connected
      if (!view.dom.ownerDocument) return;

      const content = buildTooltipForElement(view, anchor);
      if (content) {
        showFloatingTooltip(anchor, content);
      }
    }, HOVER_DELAY_MS);
  };

  const onMouseOut = (e: Event) => {
    const me = e as MouseEvent;
    const relatedTarget = me.relatedTarget as HTMLElement | null;

    // Check if mouse moved to the tooltip itself — keep it visible
    if (relatedTarget && tooltipEl?.contains(relatedTarget)) return;

    // Check if mouse moved to another widget item/container
    if (relatedTarget) {
      const stillInWidget = relatedTarget.closest(
        "[data-ref-id], .cf-crossref, .cf-citation",
      );
      if (stillInWidget) return; // onMouseOver will handle the switch
    }

    clearTimer();
    currentTarget = null;
    hideFloatingTooltip();
  };

  const scroller = view.scrollDOM;
  scroller.addEventListener("mouseover", onMouseOver);
  scroller.addEventListener("mouseout", onMouseOut);

  return {
    destroy() {
      scroller.removeEventListener("mouseover", onMouseOver);
      scroller.removeEventListener("mouseout", onMouseOut);
      clearTimer();
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
