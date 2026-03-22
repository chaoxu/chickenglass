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
import { syntaxTree } from "@codemirror/language";
import {
  type CrossrefMatch,
  type ResolvedCrossref,
  findCrossrefs,
  resolveCrossref,
  collectEquationLabels,
} from "../index/crossref-resolver";
import { blockCounterField, type NumberedBlock } from "../plugins/block-counter";
import { bibDataField, findCitationsFromTree, type BibStore } from "../citations/citation-render";
import { formatBibEntry } from "../citations/bibliography";
import { renderKatex, stripMathDelimiters } from "./math-render";
import { mathMacrosField } from "./math-macros";
import { renderInlineMarkdown } from "./inline-render";
import { readBracedLabelId } from "../parser/label-utils";

/** Maximum content length shown in hover previews. */
const MAX_PREVIEW_LENGTH = 500;

/**
 * Extract the content of a fenced div block for the given NumberedBlock.
 * Returns the inner content (between opening/closing fences) as plain text.
 */
function extractBlockContent(
  view: EditorView,
  block: NumberedBlock,
): string {
  const tree = syntaxTree(view.state);
  let contentFrom = block.from;
  let contentTo = block.to;

  const node = tree.resolve(block.from, 1);
  if (node.type.name === "FencedDiv") {
    const firstChild = node.firstChild;
    if (firstChild) {
      contentFrom = view.state.doc.lineAt(firstChild.to).to + 1;
    }
    const lastChild = node.lastChild;
    if (lastChild && lastChild.type.name === "FencedDivFence") {
      contentTo = lastChild.from;
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
 * Uses the shared Lezer-based renderInlineMarkdown (math, bold, italic, etc.).
 */
function renderContentWithMath(
  container: HTMLElement,
  content: string,
  macros: Record<string, string>,
): void {
  renderInlineMarkdown(container, content, macros);
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
  renderInlineMarkdown(header, text, macros, "document-inline");
  return header;
}

/**
 * Find the LaTeX source for an equation by its label id.
 * Scans the syntax tree for EquationLabel nodes and extracts the
 * parent DisplayMath content.
 */
function findEquationSource(view: EditorView, id: string): string | undefined {
  const tree = syntaxTree(view.state);
  const doc = view.state.doc.toString();
  let result: string | undefined;

  tree.iterate({
    enter(node) {
      if (result !== undefined) return false; // stop after first match
      if (node.type.name !== "EquationLabel") return;
      const labelId = readBracedLabelId(doc, node.from, node.to, "eq:");
      if (labelId === id) {
        const parent = node.node.parent;
        if (parent) {
          const raw = view.state.doc.sliceString(parent.from, node.from);
          result = stripMathDelimiters(raw.trim(), true);
        }
      }
    },
  });

  return result;
}

/**
 * Build the tooltip DOM for a cross-reference hover preview.
 * Accepts pre-resolved data to avoid redundant resolution.
 */
function buildCrossrefTooltip(
  view: EditorView,
  ref: CrossrefMatch,
  resolved: ResolvedCrossref,
): HTMLElement {
  const macros = view.state.field(mathMacrosField);
  const container = document.createElement("div");
  container.className = "cf-hover-preview";

  if (resolved.kind === "block") {
    container.appendChild(createHeader(resolved.label, macros));

    const counterState = view.state.field(blockCounterField, false);
    const block = counterState?.byId.get(ref.id);
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

    const eqContent = findEquationSource(view, ref.id);
    if (eqContent) {
      const body = document.createElement("div");
      body.className = "cf-hover-preview-body";
      renderKatex(body, eqContent, true, macros);
      container.appendChild(body);
    }
  } else {
    container.appendChild(
      createHeader(`Unresolved: ${ref.id}`, macros, "cf-hover-preview-unresolved"),
    );
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
 */
function hoverSource(
  view: EditorView,
  pos: number,
  _side: -1 | 1,
): Tooltip | null {
  // Check for cross-reference at this position
  const refs = findCrossrefs(view.state);
  const crossref = refs.find((ref) => pos >= ref.from && pos <= ref.to);
  if (crossref) {
    const equationLabels = collectEquationLabels(view.state);
    const resolved = resolveCrossref(view.state, crossref.id, equationLabels);

    // Skip citations — they are handled below
    if (resolved.kind !== "citation") {
      return {
        pos: crossref.from,
        end: crossref.to,
        above: true,
        create() {
          const dom = buildCrossrefTooltip(view, crossref, resolved);
          return { dom };
        },
      };
    }
  }

  // Check for citation at this position (single scan)
  const { store } = view.state.field(bibDataField);
  if (store.size > 0) {
    const tree = syntaxTree(view.state);
    const text = view.state.doc.toString();
    const matches = findCitationsFromTree(tree.topNode, text, store);
    const match = matches.find((m) => pos >= m.from && pos <= m.to);
    if (match) {
      return {
        pos: match.from,
        end: match.to,
        above: true,
        create() {
          const dom = buildCitationTooltip(match.ids, store);
          return { dom };
        },
      };
    }
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
  hoverTime: 300,
});
