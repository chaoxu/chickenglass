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
import { type EditorView, type ViewUpdate, ViewPlugin } from "@codemirror/view";
import { CSS, HOVER_DELAY_MS } from "../constants";
import {
  classifyReference,
  type ReferenceClassification,
  type ResolvedCrossref,
  resolveCrossref,
} from "../index/crossref-resolver";
import { blockCounterField, type NumberedBlock } from "../plugins/block-counter";
import {
  buildCitationPreviewContent,
  formatCitationPreview,
} from "../citations/citation-preview";
import { mathMacrosField } from "./math-macros";
import { renderKatex } from "./math-widget";
import { renderBlockContentToDom, renderDocumentFragmentToDom, type BlockContentOptions } from "../document-surfaces";
import {
  createPreviewSurfaceBody,
  createPreviewSurfaceContent,
  createPreviewSurfaceHeader,
} from "../preview-surface";
import { documentPathFacet, type BlockCounterEntry } from "../lib/types";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { collectImageTargets } from "../app/pdf-image-previews";
import { imageUrlField } from "./image-url-cache";
import {
  createLocalMediaDependencies,
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  getLocalMediaPreviewDependency,
  getLocalMediaPreviewDependencyKey,
  localMediaDependenciesChanged,
  resolveLocalMediaPreview,
  trackLocalMediaPreviewDependency,
  type LocalMediaDependencies,
} from "./media-preview";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";
import { getPlugin, pluginRegistryField } from "../plugins/plugin-registry";
import { type BibStore, bibDataField } from "../state/bib-data";
import { HoverPreviewTooltipManager } from "./hover-preview-tooltip-manager";
import { findRenderedReference } from "./reference-targeting";

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
  readonly mediaDependencies: LocalMediaDependencies;
  readonly readyPdfPreviews: readonly PdfCanvasReplacement[];
  readonly unavailableLocalMedia: readonly string[];
}

interface BlockPreviewPlan {
  readonly buildBody: () => HTMLElement | null;
  readonly key: string;
  readonly mediaDependencies: LocalMediaDependencies;
}

interface TooltipPlan {
  readonly buildContent: () => HTMLElement;
  readonly cacheScope: object;
  readonly dependsOnBibliography: boolean;
  readonly dependsOnMacros: boolean;
  readonly key: string;
  readonly mediaDependencies: LocalMediaDependencies;
}

type CrossrefPreviewVariant = "completion" | "hover";
const EMPTY_MEDIA_CACHE: ReadonlyMap<string, unknown> = new Map();
const TOOLTIP_CONTENT_CACHE_LIMIT = 8;
// Reuse preview DOM within one hover-preview owner and one immutable
// state/dependency object without carrying stale content across later updates.
const tooltipContentCache = new WeakMap<object, WeakMap<object, Map<string, HTMLElement>>>();

function getTooltipContentCache(
  cacheOwner: object,
  cacheScope: object,
): Map<string, HTMLElement> {
  let ownerCache = tooltipContentCache.get(cacheOwner);
  if (!ownerCache) {
    ownerCache = new WeakMap<object, Map<string, HTMLElement>>();
    tooltipContentCache.set(cacheOwner, ownerCache);
  }

  let cache = ownerCache.get(cacheScope);
  if (!cache) {
    cache = new Map<string, HTMLElement>();
    ownerCache.set(cacheScope, cache);
  }
  return cache;
}

function getTooltipContent(plan: TooltipPlan, cacheOwner: object): HTMLElement {
  const cache = getTooltipContentCache(cacheOwner, plan.cacheScope);
  const cached = cache.get(plan.key);
  if (cached) {
    cache.delete(plan.key);
    cache.set(plan.key, cached);
    return cached;
  }

  const content = plan.buildContent();
  cache.set(plan.key, content);
  if (cache.size > TOOLTIP_CONTENT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string;
    cache.delete(oldestKey);
  }
  return content;
}

export function getCachedTooltipContentForTest(
  cacheScope: object,
  key: string,
  buildContent: () => HTMLElement,
): HTMLElement {
  return getTooltipContent({
    buildContent,
    cacheScope,
    dependsOnBibliography: false,
    dependsOnMacros: false,
    key,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  }, cacheScope);
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

function createCrossrefPreviewContainer(
  variant: CrossrefPreviewVariant,
): HTMLElement {
  return createPreviewSurfaceContent(
    CSS.hoverPreview,
    variant === "completion" ? CSS.referenceCompletionContent : null,
  );
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
  const mediaDependencies = createLocalMediaDependencies();
  const readyPdfPreviews: PdfCanvasReplacement[] = [];
  const loadingLocalMedia: string[] = [];
  const unavailableLocalMedia: string[] = [];
  const keyParts: string[] = [];

  for (const src of collectImageTargets(text)) {
    const preview = resolveLocalMediaPreview(view, src);
    if (!preview) continue;
    const dependency = getLocalMediaPreviewDependency(src, preview);
    trackLocalMediaPreviewDependency(mediaDependencies, dependency);
    keyParts.push(getLocalMediaPreviewDependencyKey(dependency));

    if (preview.kind === "image") {
      imageUrlOverrides.set(preview.resolvedPath, preview.dataUrl);
      continue;
    }

    if (preview.kind === "pdf-canvas") {
      readyPdfPreviews.push({
        resolvedPath: preview.resolvedPath,
        src,
      });
      continue;
    }

    if (preview.kind === "loading") {
      loadingLocalMedia.push(src);
      continue;
    }

    unavailableLocalMedia.push(src);
  }

  return {
    imageUrlOverrides: imageUrlOverrides.size > 0 ? imageUrlOverrides : undefined,
    key: keyParts.join("\0"),
    loadingLocalMedia,
    mediaDependencies,
    readyPdfPreviews,
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
    includeBibliography: false,
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

  // The owning tooltip manager replaces or clears this clone together with
  // the rest of the preview content.
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
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
    mediaDependencies: mediaState.mediaDependencies,
  };
}

export function buildBlockPreviewBodyForTest(
  view: EditorView,
  block: NumberedBlock,
): HTMLElement | null {
  const macros = view.state.field(mathMacrosField, false) ?? {};
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
  variant: CrossrefPreviewVariant = "hover",
): TooltipPlan {
  const macros = view.state.field(mathMacrosField, false) ?? {};

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
        const body = bodyPlan?.buildBody();
        const container = createCrossrefPreviewContainer(variant);
        if (variant === "completion" && body) {
          container.appendChild(body);
          container.appendChild(
            createHeader(headerText, macros, CSS.referenceCompletionMeta),
          );
          return container;
        }

        container.appendChild(createHeader(headerText, macros));
        if (body) {
          container.appendChild(body);
        }
        return container;
      },
      cacheScope: view.state,
      dependsOnBibliography: true,
      dependsOnMacros: true,
      key: `crossref:block\0${variant}\0${id}\0${headerText}\0${bodyPlan?.key ?? "missing"}`,
      mediaDependencies: bodyPlan?.mediaDependencies ?? EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  if (resolved.kind === "equation") {
    const eqContent = findEquationSource(view, id);
    return {
      buildContent: () => {
        const container = createCrossrefPreviewContainer(variant);
        const body = eqContent
          ? createPreviewSurfaceBody(CSS.hoverPreviewBody)
          : null;

        if (body && eqContent) {
          renderKatex(body, eqContent, true, macros);
        }

        if (variant === "completion" && body) {
          container.appendChild(body);
          container.appendChild(
            createHeader(resolved.label, macros, CSS.referenceCompletionMeta),
          );
          return container;
        }

        container.appendChild(createHeader(resolved.label, macros));
        if (body) {
          container.appendChild(body);
        }
        return container;
      },
      cacheScope: view.state,
      dependsOnBibliography: false,
      dependsOnMacros: true,
      key: `crossref:equation\0${variant}\0${id}\0${resolved.label}\0${eqContent ?? ""}`,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  return {
    buildContent: () => {
      const container = createCrossrefPreviewContainer(variant);
      container.appendChild(
        createHeader(`Unresolved: ${id}`, macros, CSS.hoverPreviewUnresolved),
      );
      return container;
    },
    cacheScope: view.state,
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `crossref:unresolved\0${variant}\0${id}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
}

export function buildCrossrefPreviewContent(
  view: EditorView,
  id: string,
): HTMLElement {
  const equationLabels = view.state.field(documentAnalysisField, false)?.equationById;
  return buildCrossrefTooltipPlan(
    view,
    id,
    resolveCrossref(view.state, id, equationLabels ?? new Map()),
    "hover",
  ).buildContent();
}

export function buildCrossrefCompletionPreviewContent(
  view: EditorView,
  id: string,
): HTMLElement {
  const equationLabels = view.state.field(documentAnalysisField, false)?.equationById;
  return buildCrossrefTooltipPlan(
    view,
    id,
    resolveCrossref(view.state, id, equationLabels ?? new Map()),
    "completion",
  ).buildContent();
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
    cacheScope: store,
    dependsOnBibliography: true,
    dependsOnMacros: false,
    key: `citation:cluster\0${ids.join("\0")}\0${previews.map((item) => `${item.id}:${item.preview}`).join("\0")}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
  const macros = view.state.field(mathMacrosField, false) ?? {};

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
        cacheScope: store,
        dependsOnBibliography: true,
        dependsOnMacros: false,
        key: `citation:item\0${id}\0${preview}`,
        mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
      cacheScope: store,
      dependsOnBibliography: true,
      dependsOnMacros: false,
      key: `citation:item\0${id}\0unknown`,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
    cacheScope: view.state,
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `mixed:unresolved\0${id}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
  const analysis = view.state.field(documentAnalysisField, false);
  const bibData = view.state.field(bibDataField, false);
  if (!analysis || !bibData) {
    return null;
  }
  const equationLabels = analysis.equationById;

  // Check if we're hovering a data-ref-id span (cluster item)
  const refId = refIdFromElement(target);

  // Find the widget container to determine if this is crossref or citation
  const widgetEl = target.closest(".cf-crossref, .cf-citation") as HTMLElement | null;
  if (!widgetEl) return null;

  const ref = findRenderedReference(view, widgetEl);
  if (!ref) return null;

  const { store } = bibData;
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
class HoverPreviewViewPlugin {
  public readonly tooltipManager = new HoverPreviewTooltipManager();

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTarget: HTMLElement | null = null;
  private currentPlan: TooltipPlan | null = null;

  public constructor(private readonly view: EditorView) {
    this.view.scrollDOM.addEventListener("mouseover", this.onMouseOver);
    this.view.scrollDOM.addEventListener("mouseout", this.onMouseOut);
  }

  public update(update: ViewUpdate): void {
    const beforeAnalysis = update.startState.field(documentAnalysisField, false);
    const afterAnalysis = update.state.field(documentAnalysisField, false);
    const beforeBibData = update.startState.field(bibDataField, false);
    const afterBibData = update.state.field(bibDataField, false);
    const beforeMacros = update.startState.field(mathMacrosField, false);
    const afterMacros = update.state.field(mathMacrosField, false);

    if (!afterAnalysis || !afterBibData) {
      this.currentTarget = null;
      this.currentPlan = null;
      this.tooltipManager.hide();
      return;
    }

    const localMediaChanged = localMediaDependenciesChanged(
      this.currentPlan?.mediaDependencies ?? EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
      (bibliographyChanged && this.currentPlan?.dependsOnBibliography === true) ||
      (macrosChanged && this.currentPlan?.dependsOnMacros === true);

    if (
      localMediaChanged ||
      forceRebuild ||
      update.docChanged ||
      analysisChanged ||
      blockCountersChanged
    ) {
      this.refreshOpenTooltip(forceRebuild);
      return;
    }

    if (this.currentTarget && !this.currentTarget.isConnected) {
      this.currentTarget = null;
      this.currentPlan = null;
      this.tooltipManager.hide();
    }
  }

  public destroy(): void {
    this.view.scrollDOM.removeEventListener("mouseover", this.onMouseOver);
    this.view.scrollDOM.removeEventListener("mouseout", this.onMouseOut);
    this.clearTimer();
    this.currentPlan = null;
    this.tooltipManager.destroy();
  }

  private clearTimer(): void {
    if (this.hoverTimer === null) return;
    clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
  }

  private readonly onMouseOver = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (!target || target === this.currentTarget) return;

    const widgetItem = target.closest("[data-ref-id]") as HTMLElement | null;
    const widgetContainer = target.closest(".cf-crossref, .cf-citation") as HTMLElement | null;
    const anchor = widgetItem ?? widgetContainer;
    if (!anchor) {
      if (this.currentTarget) {
        this.clearTimer();
        this.currentTarget = null;
        this.currentPlan = null;
        this.tooltipManager.hide();
      }
      return;
    }

    if (anchor === this.currentTarget) return;

    this.clearTimer();
    this.currentTarget = anchor;
    this.currentPlan = null;
    this.tooltipManager.hide();

    this.hoverTimer = setTimeout(() => {
      if (!this.view.dom.ownerDocument) return;

      const plan = buildTooltipPlanForElement(this.view, anchor);
      if (!plan) return;

      this.currentPlan = plan;
      this.tooltipManager.show(anchor, getTooltipContent(plan, this));
    }, HOVER_DELAY_MS);
  };

  private readonly onMouseOut = (e: Event): void => {
    const me = e as MouseEvent;
    const relatedTarget = me.relatedTarget as HTMLElement | null;

    if (this.tooltipManager.contains(relatedTarget)) return;

    if (relatedTarget) {
      const stillInWidget = relatedTarget.closest(
        "[data-ref-id], .cf-crossref, .cf-citation",
      );
      if (stillInWidget) return;
    }

    this.clearTimer();
    this.currentTarget = null;
    this.currentPlan = null;
    this.tooltipManager.hide();
  };

  private refreshOpenTooltip(forceRebuild = false): void {
    if (!this.currentTarget) return;
    if (!this.currentTarget.isConnected) {
      this.currentTarget = null;
      this.currentPlan = null;
      this.tooltipManager.hide();
      return;
    }
    if (!this.tooltipManager.isVisible()) return;

    const nextPlan = buildTooltipPlanForElement(this.view, this.currentTarget);
    if (!nextPlan) {
      this.currentPlan = null;
      this.tooltipManager.hide();
      return;
    }

    if (!forceRebuild && this.currentPlan && nextPlan.key === this.currentPlan.key) {
      this.currentPlan = nextPlan;
      return;
    }

    this.currentPlan = nextPlan;
    this.tooltipManager.show(this.currentTarget, getTooltipContent(nextPlan, this));
  }
}

const hoverPreviewPlugin = ViewPlugin.fromClass(HoverPreviewViewPlugin);

function getHoverPreviewViewPluginForTest(view: EditorView): HoverPreviewViewPlugin {
  const plugin = view.plugin(hoverPreviewPlugin as never) as HoverPreviewViewPlugin | null;
  if (!plugin) {
    throw new Error("Hover preview plugin is not active for this view");
  }
  return plugin;
}

export function ensureHoverPreviewTooltipForTest(view: EditorView): HTMLDivElement {
  return getHoverPreviewViewPluginForTest(view).tooltipManager.ensureTooltipElementForTest();
}

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
