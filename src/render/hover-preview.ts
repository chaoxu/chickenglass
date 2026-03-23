/**
 * CM6 hover tooltip for cross-references and citations.
 *
 * When hovering over a [@id] cross-reference, shows a preview of the
 * referenced block content (with KaTeX math rendering). When hovering
 * over a citation, shows the formatted bibliography entry.
 *
 * Uses CM6's hoverTooltip extension for positioning and lifecycle.
 */

import { type Extension } from "@codemirror/state";
import { type EditorView, type Tooltip, hoverTooltip, ViewPlugin } from "@codemirror/view";
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
import { renderBlockContentToDom, renderDocumentFragmentToDom } from "../document-surfaces";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { SEARCH_CONTEXT_BUFFER, HOVER_DELAY_MS } from "../constants";

/** Maximum content length shown in hover previews. */
const MAX_PREVIEW_LENGTH = SEARCH_CONTEXT_BUFFER;

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

  const content = view.state.doc.sliceString(contentFrom, contentTo).trim();
  if (content.length > MAX_PREVIEW_LENGTH) {
    return content.slice(0, MAX_PREVIEW_LENGTH) + "\u2026";
  }
  return content;
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
        renderBlockContentToDom(body, content, macros);
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
 * Lightweight ViewPlugin that records the last mouse position within the
 * editor. CM6's hoverTooltip collapses widget positions to the widget's
 * start, so we need the real mouse coordinates to distinguish sub-items
 * inside clustered crossref widgets via `document.elementFromPoint`.
 */
let lastMouseX = 0;
let lastMouseY = 0;

const mouseTrackerPlugin = ViewPlugin.define((view) => {
  const onMouseMove = (e: MouseEvent) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  };
  view.dom.addEventListener("mousemove", onMouseMove);
  return {
    destroy() {
      view.dom.removeEventListener("mousemove", onMouseMove);
    },
  };
});

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

/**
 * Find the `data-ref-id` of the hovered sub-span inside a cluster widget
 * using actual mouse coordinates.
 *
 * CM6's hoverTooltip gives us a document `pos` that collapses to the
 * widget start for replaced ranges — useless for distinguishing items
 * within the widget. Instead we use `document.elementFromPoint` with
 * the real mouse position tracked by `mouseTrackerPlugin`.
 *
 * Returns null when the pointer is on a separator text node or outside
 * any item span (no tooltip should be shown).
 */
function findHoveredRefId(_view: EditorView, _pos: number): string | null {
  const el = document.elementFromPoint(lastMouseX, lastMouseY);
  return refIdFromElement(el);
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

/**
 * The hover tooltip source function for cross-references and citations.
 *
 * Handles single-id refs, multi-id crossref clusters, pure citation
 * clusters, and mixed crossref+citation clusters.
 *
 * For multi-id clusters, performs per-item targeting: checks which sub-span
 * the hover position falls on and shows a tooltip for that single item.
 * Hovering on a separator ("; ") returns null (no tooltip).
 */
function hoverSource(
  view: EditorView,
  pos: number,
  _side: -1 | 1,
): Tooltip | null {
  const analysis = view.state.field(documentAnalysisField);
  const allRefs = analysis.references;
  const equationLabels = analysis.equationById;

  // Find the reference at this position
  const ref = allRefs.find((r) => pos >= r.from && pos <= r.to);
  if (!ref) return null;

  // Resolve every id in the reference
  const resolutions = ref.ids.map((id) =>
    resolveCrossref(view.state, id, equationLabels),
  );
  const hasCrossref = resolutions.some((r) => r.kind !== "citation");

  // Single-id crossref — use the original compact tooltip
  if (ref.ids.length === 1 && hasCrossref) {
    return {
      pos: ref.from,
      end: ref.to,
      above: true,
      create() {
        const dom = buildCrossrefTooltip(view, ref, resolutions[0]);
        return { dom };
      },
    };
  }

  // Multi-id cluster containing at least one crossref — per-item targeting
  if (ref.ids.length > 1 && hasCrossref) {
    const { store } = view.state.field(bibDataField);
    // Find which sub-span the hover pos falls on
    const hoveredId = findHoveredRefId(view, pos);
    if (!hoveredId) return null; // Hovering on separator — no tooltip

    const itemIndex = ref.ids.indexOf(hoveredId);
    if (itemIndex < 0) return null;

    const hoveredResolved = resolutions[itemIndex];
    return {
      pos: ref.from,
      end: ref.to,
      above: true,
      create() {
        const dom = buildSingleItemTooltip(view, hoveredId, hoveredResolved, store);
        return { dom };
      },
    };
  }

  // Pure citation cluster (no crossrefs resolved)
  const { store } = view.state.field(bibDataField);
  if (store.size > 0 && ref.ids.some((id) => store.has(id))) {
    return {
      pos: ref.from,
      end: ref.to,
      above: true,
      create() {
        const dom = buildCitationTooltip(ref.ids, store);
        return { dom };
      },
    };
  }

  return null;
}

/**
 * CM6 extension that shows hover previews for cross-references and citations.
 *
 * Includes a mouse-position tracker so that clustered crossref widgets can
 * use `document.elementFromPoint` to distinguish individual sub-items.
 * CM6's hoverTooltip collapses widget positions to the widget start, making
 * `view.domAtPos(pos)` useless for per-item targeting inside widgets.
 *
 * Positioning is handled entirely by CM6's hoverTooltip, which includes its
 * own collision detection. @floating-ui/dom was evaluated (#180, #189) but
 * is not applicable here — CM6's tooltip system already manages placement.
 */
export const hoverPreviewExtension: Extension = [
  mouseTrackerPlugin,
  hoverTooltip(hoverSource, {
    hoverTime: HOVER_DELAY_MS,
  }),
];
