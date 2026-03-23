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
import { type EditorView, type Tooltip, hoverTooltip } from "@codemirror/view";
import {
  type ResolvedCrossref,
  resolveCrossref,
} from "../index/crossref-resolver";
import type { ReferenceSemantics } from "../semantics/document";
import { blockCounterField, type NumberedBlock } from "../plugins/block-counter";
import { bibDataField, type BibStore } from "../citations/citation-render";
import { formatBibEntry } from "../citations/bibliography";
import { renderKatex } from "./math-render";
import { mathMacrosField } from "./math-macros";
import { renderDocumentFragmentToDom } from "../document-surfaces";
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

/**
 * Render markdown content with full inline formatting into a DOM element.
 */
function renderContentWithMath(
  container: HTMLElement,
  content: string,
  macros: Record<string, string>,
): void {
  renderDocumentFragmentToDom(container, {
    kind: "hover",
    text: content,
    macros,
  });
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
        renderContentWithMath(body, content, macros);
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
 * Build a tooltip with per-item preview sections for a clustered reference
 * containing one or more cross-references (and optionally citations).
 */
function buildClusteredTooltip(
  view: EditorView,
  ids: readonly string[],
  resolutions: readonly ResolvedCrossref[],
  store: BibStore,
): HTMLElement {
  const macros = view.state.field(mathMacrosField);
  const container = document.createElement("div");
  container.className = "cf-hover-preview";

  for (let i = 0; i < ids.length; i++) {
    if (i > 0) {
      const sep = document.createElement("hr");
      sep.className = "cf-hover-preview-separator";
      container.appendChild(sep);
    }

    const id = ids[i];
    const resolved = resolutions[i];

    if (resolved.kind === "citation") {
      // Render as citation if bib entry exists
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
  }

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
 * The hover tooltip source function for cross-references and citations.
 *
 * Handles single-id refs, multi-id crossref clusters, pure citation
 * clusters, and mixed crossref+citation clusters.
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

  // Multi-id cluster containing at least one crossref
  if (ref.ids.length > 1 && hasCrossref) {
    const { store } = view.state.field(bibDataField);
    return {
      pos: ref.from,
      end: ref.to,
      above: true,
      create() {
        const dom = buildClusteredTooltip(view, ref.ids, resolutions, store);
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
 * Positioning is handled entirely by CM6's hoverTooltip, which includes its
 * own collision detection. @floating-ui/dom was evaluated (#180, #189) but
 * is not applicable here — CM6's tooltip system already manages placement.
 */
export const hoverPreviewExtension: Extension = hoverTooltip(hoverSource, {
  hoverTime: HOVER_DELAY_MS,
});
