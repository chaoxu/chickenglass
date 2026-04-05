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
import { autoUpdate, computePosition, flip, shift, offset } from "@floating-ui/dom";
import { CSS, HOVER_DELAY_MS } from "../constants";
import {
  classifyReference,
  type ReferenceClassification,
  type ResolvedCrossref,
} from "../index/crossref-resolver";
import type { ReferenceSemantics } from "../semantics/document";
import { blockCounterField, type NumberedBlock } from "../plugins";
import { bibDataField, type BibStore } from "../citations/citation-render";
import {
  buildCitationPreviewContent,
  formatCitationPreview,
} from "../citations/citation-preview";
import { renderKatex } from "./math-render";
import { mathMacrosField } from "./math-macros";
import { renderBlockContentToDom, renderDocumentFragmentToDom, type BlockContentOptions } from "../document-surfaces";
import {
  createPreviewSurfaceBody,
  createPreviewSurfaceContent,
  createPreviewSurfaceHeader,
  createPreviewSurfaceShell,
} from "../preview-surface";
import { getPlugin, pluginRegistryField } from "../plugins";
import { documentPathFacet, type BlockCounterEntry } from "../lib/types";
import { isPdfTarget } from "../lib/pdf-target";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { collectImageTargets } from "../app/pdf-image-previews";
import { imageUrlField } from "./image-url-cache";
import { resolveLocalMediaPreview } from "./media-preview";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";

// ── Singleton tooltip element ───────────────────────────────────────────────

let tooltipEl: HTMLDivElement | null = null;
let hoverPreviewInstanceCount = 0;
const HOVER_PREVIEW_TABLE_SCROLL_CLASS = "cf-hover-preview-table-scroll";
const HOVER_PREVIEW_CODE_BLOCK_CLASS = "cf-hover-preview-code-block";

interface PdfCanvasReplacement {
  readonly resolvedPath: string;
  readonly src: string;
}

interface BlockPreviewMediaState {
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly key: string;
  readonly loadingLocalMedia: readonly string[];
  readonly readyPdfPreviews: readonly PdfCanvasReplacement[];
  readonly trackedImagePaths: ReadonlySet<string>;
  readonly trackedPdfPaths: ReadonlySet<string>;
  readonly unavailableLocalMedia: readonly string[];
}

interface BlockPreviewPlan {
  readonly buildBody: () => HTMLElement | null;
  readonly key: string;
  readonly trackedImagePaths: ReadonlySet<string>;
  readonly trackedPdfPaths: ReadonlySet<string>;
}

interface TooltipPlan {
  readonly buildContent: () => HTMLElement;
  readonly dependsOnBibliography: boolean;
  readonly dependsOnMacros: boolean;
  readonly key: string;
  readonly trackedImagePaths: ReadonlySet<string>;
  readonly trackedPdfPaths: ReadonlySet<string>;
}

const EMPTY_TRACKED_PATHS: ReadonlySet<string> = new Set();
const EMPTY_MEDIA_CACHE: ReadonlyMap<string, unknown> = new Map();

function getTooltipEl(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = createPreviewSurfaceShell(CSS.hoverPreviewTooltip);
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

/**
 * Cleanup function returned by `autoUpdate` — stops the scroll/resize
 * listeners that keep the tooltip anchored. Stored so `hideFloatingTooltip`
 * can tear it down.
 */
let cleanupAutoUpdate: (() => void) | null = null;
let currentFloatingAnchor: HTMLElement | null = null;
let refreshFloatingPosition: (() => void) | null = null;

/**
 * Monotonic generation counter. Incremented on every `showFloatingTooltip`
 * call so that a late-resolving `computePosition` promise from an older
 * show cycle is silently discarded. (#474)
 */
let showGeneration = 0;

/**
 * Position and show the singleton tooltip near an anchor element using
 * @floating-ui/dom's `computePosition` with flip+shift middleware.
 *
 * Uses `autoUpdate` so the tooltip tracks the anchor on scroll, resize,
 * and layout shift — preventing the drift reported in #474.
 */
function showFloatingTooltip(anchor: HTMLElement, content: HTMLElement): void {
  const el = getTooltipEl();
  const anchorChanged = anchor !== currentFloatingAnchor;

  if (anchorChanged) {
    if (cleanupAutoUpdate) {
      cleanupAutoUpdate();
      cleanupAutoUpdate = null;
    }

    currentFloatingAnchor = anchor;
    const gen = ++showGeneration;

    const updatePosition = () => {
      void computePosition(anchor, el, {
        placement: "top",
        middleware: [offset(6), flip(), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        // Stale guard: if a newer show cycle started before this promise
        // resolved, discard the result so we don't overwrite the new
        // tooltip's position with coordinates for the old anchor. (#474)
        if (gen !== showGeneration) return;

        Object.assign(el.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    };

    refreshFloatingPosition = updatePosition;

    // `autoUpdate` calls `updatePosition` immediately, then again whenever
    // the anchor or floating element moves (scroll, resize, layout shift).
    cleanupAutoUpdate = autoUpdate(anchor, el, updatePosition);
  }

  el.replaceChildren(content);

  const wasHidden = el.style.display === "none";
  el.style.display = "";
  if (wasHidden) {
    el.setAttribute("data-visible", "false");
  }

  refreshFloatingPosition?.();

  if (wasHidden) {
    const visibleGeneration = showGeneration;
    requestAnimationFrame(() => {
      if (visibleGeneration === showGeneration) {
        el.setAttribute("data-visible", "true");
      }
    });
  } else {
    el.setAttribute("data-visible", "true");
  }
}

/** Hide and clear the singleton tooltip. */
function hideFloatingTooltip(): void {
  if (cleanupAutoUpdate) {
    cleanupAutoUpdate();
    cleanupAutoUpdate = null;
  }
  currentFloatingAnchor = null;
  refreshFloatingPosition = null;
  showGeneration += 1;
  if (tooltipEl) {
    tooltipEl.setAttribute("data-visible", "false");
    tooltipEl.style.display = "none";
    tooltipEl.replaceChildren();
  }
}

function destroyFloatingTooltip(): void {
  hideFloatingTooltip();
  tooltipEl?.remove();
  tooltipEl = null;
}

export function ensureHoverPreviewTooltipForTest(): HTMLDivElement {
  return getTooltipEl();
}

export function destroyHoverPreviewTooltipForTest(): void {
  destroyFloatingTooltip();
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

function extractBlockSource(
  view: EditorView,
  block: NumberedBlock,
): string {
  return view.state.doc.sliceString(block.from, block.to).trim();
}

/** Create a header div for the tooltip. */
function createHeader(
  text: string,
  macros: Record<string, string> = {},
  extraClass?: string,
): HTMLElement {
  const header = createPreviewSurfaceHeader(CSS.hoverPreviewHeader, extraClass);
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
function buildBlockPreviewMediaState(
  view: EditorView,
  text: string,
): BlockPreviewMediaState {
  const imageUrlOverrides = new Map<string, string>();
  const readyPdfPreviews: PdfCanvasReplacement[] = [];
  const loadingLocalMedia: string[] = [];
  const trackedImagePaths = new Set<string>();
  const trackedPdfPaths = new Set<string>();
  const unavailableLocalMedia: string[] = [];
  const keyParts: string[] = [];

  for (const src of collectImageTargets(text)) {
    const preview = resolveLocalMediaPreview(view, src);
    if (!preview) continue;

    if (preview.kind === "image") {
      imageUrlOverrides.set(preview.resolvedPath, preview.dataUrl);
      trackedImagePaths.add(preview.resolvedPath);
      keyParts.push(`image:${preview.resolvedPath}:ready`);
      continue;
    }

    if (preview.kind === "pdf-canvas") {
      readyPdfPreviews.push({
        resolvedPath: preview.resolvedPath,
        src,
      });
      trackedPdfPaths.add(preview.resolvedPath);
      keyParts.push(`pdf:${preview.resolvedPath}:ready`);
      continue;
    }

    if (preview.kind === "loading") {
      if (preview.isPdf) {
        trackedPdfPaths.add(preview.resolvedPath);
      } else {
        trackedImagePaths.add(preview.resolvedPath);
      }
      keyParts.push(`${preview.isPdf ? "pdf" : "image"}:${preview.resolvedPath}:loading`);
      loadingLocalMedia.push(src);
      continue;
    }

    if (isPdfTarget(src)) {
      trackedPdfPaths.add(preview.resolvedPath);
      keyParts.push(`pdf:${preview.resolvedPath}:error`);
    } else {
      trackedImagePaths.add(preview.resolvedPath);
      keyParts.push(`image:${preview.resolvedPath}:error`);
    }
    unavailableLocalMedia.push(src);
  }

  return {
    imageUrlOverrides: imageUrlOverrides.size > 0 ? imageUrlOverrides : undefined,
    key: keyParts.join("\0"),
    loadingLocalMedia,
    readyPdfPreviews,
    trackedImagePaths,
    trackedPdfPaths,
    unavailableLocalMedia,
  };
}

function buildBlockContentOptions(
  view: EditorView,
  macros: Record<string, string>,
  imageUrlOverrides?: ReadonlyMap<string, string>,
): BlockContentOptions {
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
    documentPath: view.state.facet(documentPathFacet),
    imageUrlOverrides,
  };
}

function appendMediaFallback(
  body: HTMLElement,
  loadingLocalMedia: readonly string[],
  unavailableLocalMedia: readonly string[],
): void {
  if (loadingLocalMedia.length === 0 && unavailableLocalMedia.length === 0) return;

  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (src && (loadingLocalMedia.includes(src) || unavailableLocalMedia.includes(src))) {
      img.remove();
    }
  }

  if (loadingLocalMedia.length > 0) {
    const loading = createPreviewSurfaceBody(CSS.hoverPreviewUnresolved);
    loading.textContent = `Loading preview: ${loadingLocalMedia
      .map((src) => src.split("/").pop() ?? src)
      .join(", ")}`;
    body.appendChild(loading);
  }

  if (unavailableLocalMedia.length > 0) {
    const fallback = createPreviewSurfaceBody(CSS.hoverPreviewUnresolved);
    fallback.textContent = `Preview unavailable: ${unavailableLocalMedia
      .map((src) => src.split("/").pop() ?? src)
      .join(", ")}`;
    body.appendChild(fallback);
  }
}

function normalizeWidePreviewContent(body: HTMLElement): void {
  for (const table of body.querySelectorAll("table")) {
    const parent = table.parentElement;
    if (!parent || parent.classList.contains(HOVER_PREVIEW_TABLE_SCROLL_CLASS)) continue;

    const scroll = document.createElement("div");
    scroll.className = HOVER_PREVIEW_TABLE_SCROLL_CLASS;
    parent.insertBefore(scroll, table);
    scroll.appendChild(table);
  }

  for (const pre of body.querySelectorAll("pre")) {
    pre.classList.add(HOVER_PREVIEW_CODE_BLOCK_CLASS);
  }
}

export function normalizeWidePreviewContentForTest(body: HTMLElement): void {
  normalizeWidePreviewContent(body);
}

function clonePdfCanvasForHoverPreview(
  source: HTMLCanvasElement,
  alt: string,
): HTMLCanvasElement {
  const clone = document.createElement("canvas");
  clone.width = source.width;
  clone.height = source.height;
  clone.style.display = "block";
  clone.style.marginInline = "auto";
  clone.style.maxWidth = "100%";
  clone.style.height = "auto";
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-label", alt || "PDF preview");

  // The tooltip owns this clone. When the singleton tooltip replaces or
  // clears its children, the cloned canvas becomes unreachable as well.
  const ctx = clone.getContext("2d");
  if (ctx) {
    ctx.drawImage(source, 0, 0);
  }

  return clone;
}

function replacePdfPreviewImages(
  body: HTMLElement,
  readyPdfPreviews: readonly PdfCanvasReplacement[],
): void {
  if (readyPdfPreviews.length === 0) return;

  const replacementBySrc = new Map(
    readyPdfPreviews.map((preview) => [preview.src, preview.resolvedPath] as const),
  );

  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src) continue;

    const resolvedPath = replacementBySrc.get(src);
    if (!resolvedPath) continue;

    const sourceCanvas = getPdfCanvas(resolvedPath);
    if (!sourceCanvas) continue;

    img.replaceWith(
      clonePdfCanvasForHoverPreview(sourceCanvas, img.getAttribute("alt") ?? ""),
    );
  }
}

function buildBlockPreviewPlan(
  view: EditorView,
  block: NumberedBlock,
  useFullBlockSource: boolean,
  macros: Record<string, string>,
): BlockPreviewPlan {
  const text = useFullBlockSource
    ? extractBlockSource(view, block)
    : extractBlockContent(view, block);
  if (!text) {
    return {
      buildBody: () => null,
      key: `${useFullBlockSource ? "full" : "inner"}\0empty`,
      trackedImagePaths: new Set<string>(),
      trackedPdfPaths: new Set<string>(),
    };
  }

  const mediaState = buildBlockPreviewMediaState(view, text);
  return {
    buildBody: () => {
      const body = createPreviewSurfaceBody(CSS.hoverPreviewBody);
      renderBlockContentToDom(
        body,
        text,
        buildBlockContentOptions(view, macros, mediaState.imageUrlOverrides),
      );
      replacePdfPreviewImages(body, mediaState.readyPdfPreviews);
      normalizeWidePreviewContent(body);
      appendMediaFallback(
        body,
        mediaState.loadingLocalMedia,
        mediaState.unavailableLocalMedia,
      );
      return body;
    },
    key: `${useFullBlockSource ? "full" : "inner"}\0${text}\0${mediaState.key}`,
    trackedImagePaths: mediaState.trackedImagePaths,
    trackedPdfPaths: mediaState.trackedPdfPaths,
  };
}

export function buildBlockPreviewBodyForTest(
  view: EditorView,
  block: NumberedBlock,
): HTMLElement | null {
  const macros = view.state.field(mathMacrosField);
  const registry = view.state.field(pluginRegistryField, false);
  const plugin = registry ? getPlugin(registry, block.type) : undefined;
  return buildBlockPreviewPlan(
    view,
    block,
    plugin?.captionPosition === "below",
    macros,
  ).buildBody();
}

/**
 * Build the tooltip plan for a cross-reference hover preview.
 * Accepts pre-resolved data to avoid redundant resolution.
 */
function buildCrossrefTooltipPlan(
  view: EditorView,
  id: string,
  resolved: ResolvedCrossref,
): TooltipPlan {
  const macros = view.state.field(mathMacrosField);

  if (resolved.kind === "block") {
    const headerText =
      resolved.title && resolved.title !== resolved.label
        ? `${resolved.label} ${resolved.title}`
        : resolved.label;

    const counterState = view.state.field(blockCounterField, false);
    const block = counterState?.byId.get(id);
    const registry = view.state.field(pluginRegistryField, false);
    const plugin = block && registry ? getPlugin(registry, block.type) : undefined;
    const bodyPlan = block
      ? buildBlockPreviewPlan(view, block, plugin?.captionPosition === "below", macros)
      : null;

    return {
      buildContent: () => {
        const container = createPreviewSurfaceContent(CSS.hoverPreview);
        container.appendChild(createHeader(headerText, macros));
        const body = bodyPlan?.buildBody();
        if (body) {
          container.appendChild(body);
        }
        return container;
      },
      dependsOnBibliography: true,
      dependsOnMacros: true,
      key: `crossref:block\0${id}\0${headerText}\0${bodyPlan?.key ?? "missing"}`,
      trackedImagePaths: bodyPlan?.trackedImagePaths ?? new Set<string>(),
      trackedPdfPaths: bodyPlan?.trackedPdfPaths ?? new Set<string>(),
    };
  }

  if (resolved.kind === "equation") {
    const eqContent = findEquationSource(view, id);
    return {
      buildContent: () => {
        const container = createPreviewSurfaceContent(CSS.hoverPreview);
        container.appendChild(createHeader(resolved.label, macros));
        if (eqContent) {
          const body = createPreviewSurfaceBody(CSS.hoverPreviewBody);
          renderKatex(body, eqContent, true, macros);
          container.appendChild(body);
        }
        return container;
      },
      dependsOnBibliography: false,
      dependsOnMacros: true,
      key: `crossref:equation\0${id}\0${resolved.label}\0${eqContent ?? ""}`,
      trackedImagePaths: new Set<string>(),
      trackedPdfPaths: new Set<string>(),
    };
  }

  return {
    buildContent: () => {
      const container = createPreviewSurfaceContent(CSS.hoverPreview);
      container.appendChild(
        createHeader(`Unresolved: ${id}`, macros, CSS.hoverPreviewUnresolved),
      );
      return container;
    },
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `crossref:unresolved\0${id}`,
    trackedImagePaths: new Set<string>(),
    trackedPdfPaths: new Set<string>(),
  };
}

/**
 * Build the tooltip plan for a citation hover preview.
 */
function buildCitationTooltipPlan(
  ids: readonly string[],
  store: BibStore,
): TooltipPlan {
  const previews = ids
    .map((id) => {
      const entry = store.get(id);
      if (!entry) return null;
      return { id, preview: formatCitationPreview(entry) };
    })
    .filter((item): item is { id: string; preview: string } => item !== null);

  return {
    buildContent: () => {
      const container = createPreviewSurfaceContent(CSS.hoverPreview);

      for (const itemPreview of previews) {
        const item = createPreviewSurfaceBody(CSS.hoverPreviewCitation);
        item.appendChild(buildCitationPreviewContent(itemPreview.preview));
        container.appendChild(item);
      }

      if (container.children.length === 0) {
        container.appendChild(
          createHeader(`Unknown citation: ${ids.join(", ")}`, {}, CSS.hoverPreviewUnresolved),
        );
      }

      return container;
    },
    dependsOnBibliography: true,
    dependsOnMacros: false,
    key: `citation:cluster\0${ids.join("\0")}\0${previews.map((item) => `${item.id}:${item.preview}`).join("\0")}`,
    trackedImagePaths: new Set<string>(),
    trackedPdfPaths: new Set<string>(),
  };
}

/**
 * Build the tooltip plan for a specific id within a mixed cluster.
 */
function buildSingleItemTooltipPlan(
  view: EditorView,
  id: string,
  resolved: ReferenceClassification,
  store: BibStore,
): TooltipPlan {
  const macros = view.state.field(mathMacrosField);

  if (resolved.kind === "citation") {
    const entry = store.get(id);
    if (entry) {
      const preview = formatCitationPreview(entry);
      return {
        buildContent: () => {
          const container = createPreviewSurfaceContent(CSS.hoverPreview);
          const item = createPreviewSurfaceBody(CSS.hoverPreviewCitation);
          item.appendChild(buildCitationPreviewContent(preview));
          container.appendChild(item);
          return container;
        },
        dependsOnBibliography: true,
        dependsOnMacros: false,
        key: `citation:item\0${id}\0${preview}`,
        trackedImagePaths: new Set<string>(),
        trackedPdfPaths: new Set<string>(),
      };
    }

    return {
      buildContent: () => {
        const container = createPreviewSurfaceContent(CSS.hoverPreview);
        container.appendChild(
          createHeader(`Unknown: @${id}`, macros, CSS.hoverPreviewUnresolved),
        );
        return container;
      },
      dependsOnBibliography: true,
      dependsOnMacros: false,
      key: `citation:item\0${id}\0unknown`,
      trackedImagePaths: new Set<string>(),
      trackedPdfPaths: new Set<string>(),
    };
  }

  if (resolved.kind === "crossref") {
    return buildCrossrefTooltipPlan(view, id, resolved.resolved);
  }

  return {
    buildContent: () => {
      const container = createPreviewSurfaceContent(CSS.hoverPreview);
      container.appendChild(
        createHeader(`Unresolved: ${id}`, macros, CSS.hoverPreviewUnresolved),
      );
      return container;
    },
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `mixed:unresolved\0${id}`,
    trackedImagePaths: new Set<string>(),
    trackedPdfPaths: new Set<string>(),
  };
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
 * Returns a lazy tooltip plan, or null if no tooltip should show
 * (e.g., hovering on a separator text node).
 */
function buildTooltipPlanForElement(
  view: EditorView,
  target: HTMLElement,
): TooltipPlan | null {
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

  const { store } = view.state.field(bibDataField);
  const classifications = ref.ids.map((id) =>
    classifyReference(view.state, id, {
      bibliography: store,
      equationLabels,
      preferCitation: ref.bracketed,
    }),
  );
  const hasCrossref = classifications.some((classification) => classification.kind === "crossref");

  // Single-id crossref
  if (ref.ids.length === 1 && classifications[0].kind === "crossref") {
    return buildCrossrefTooltipPlan(view, ref.ids[0], classifications[0].resolved);
  }

  // Multi-id cluster — per-item targeting via data-ref-id
  if (ref.ids.length > 1 && hasCrossref) {
    if (!refId) return null; // Hovering on separator — no tooltip
    const itemIndex = ref.ids.indexOf(refId);
    if (itemIndex < 0) return null;
    return buildSingleItemTooltipPlan(view, refId, classifications[itemIndex], store);
  }

  // Pure citation cluster
  if (classifications.some((classification) => classification.kind === "citation")) {
    // If we have a specific ref-id in the cluster, show single item
    if (refId && ref.ids.includes(refId)) {
      const itemIndex = ref.ids.indexOf(refId);
      return buildSingleItemTooltipPlan(view, refId, classifications[itemIndex], store);
    }
    return buildCitationTooltipPlan(ref.ids, store);
  }

  return null;
}

function cacheEntriesChanged<T>(
  paths: ReadonlySet<string>,
  oldCache: ReadonlyMap<string, T>,
  newCache: ReadonlyMap<string, T>,
): boolean {
  if (paths.size === 0 || oldCache === newCache) return false;

  for (const path of paths) {
    if (oldCache.get(path) !== newCache.get(path)) {
      return true;
    }
  }

  return false;
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
    const widgetContainer = target.closest(".cf-crossref, .cf-citation") as HTMLElement | null;

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
        showFloatingTooltip(anchor, plan.buildContent());
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
    if (!tooltipEl || tooltipEl.style.display === "none") return;

    const nextPlan = buildTooltipPlanForElement(view, currentTarget);
    if (!nextPlan) {
      currentPlan = null;
      hideFloatingTooltip();
      return;
    }

    if (!forceRebuild && currentPlan && nextPlan.key === currentPlan.key) {
      currentPlan = nextPlan;
      return;
    }

    currentPlan = nextPlan;
    showFloatingTooltip(currentTarget, nextPlan.buildContent());
  };

  const scroller = view.scrollDOM;
  scroller.addEventListener("mouseover", onMouseOver);
  scroller.addEventListener("mouseout", onMouseOut);

  return {
    update(update) {
      const imageCacheChanged = cacheEntriesChanged(
        currentPlan?.trackedImagePaths ?? EMPTY_TRACKED_PATHS,
        update.startState.field(imageUrlField, false) || EMPTY_MEDIA_CACHE,
        update.state.field(imageUrlField, false) || EMPTY_MEDIA_CACHE,
      );
      const pdfCacheChanged = cacheEntriesChanged(
        currentPlan?.trackedPdfPaths ?? EMPTY_TRACKED_PATHS,
        update.startState.field(pdfPreviewField, false) || EMPTY_MEDIA_CACHE,
        update.state.field(pdfPreviewField, false) || EMPTY_MEDIA_CACHE,
      );
      const analysisChanged =
        update.startState.field(documentAnalysisField) !== update.state.field(documentAnalysisField);
      const blockCountersChanged =
        update.startState.field(blockCounterField, false) !== update.state.field(blockCounterField, false);
      const bibliographyChanged =
        update.startState.field(bibDataField) !== update.state.field(bibDataField);
      const macrosChanged =
        update.startState.field(mathMacrosField) !== update.state.field(mathMacrosField);
      const forceRebuild =
        (bibliographyChanged && currentPlan?.dependsOnBibliography === true) ||
        (macrosChanged && currentPlan?.dependsOnMacros === true);

      if (
        imageCacheChanged ||
        pdfCacheChanged ||
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
