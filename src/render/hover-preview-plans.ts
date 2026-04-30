import { type EditorView } from "@codemirror/view";
import { CSS } from "../constants";
import {
  createEditorReferencePresentationController,
  type ReferenceClassification,
  type ResolvedCrossref,
} from "../references/presentation";
import { blockCounterField, type NumberedBlock } from "../state/block-counter";
import { mathMacrosField } from "../state/math-macros";
import { renderKatex } from "./math-widget";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { createPreviewSurfaceBody } from "../preview-surface";
import { documentAnalysisField } from "../state/document-analysis";
import {
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  type LocalMediaDependencies,
} from "./media-preview";
import {
  appendMediaFallback,
  buildBlockPreviewMediaState,
  normalizeWidePreviewContent,
  replacePdfPreviewImages,
} from "./hover-preview-media";
import { type BibStore, bibDataField } from "../state/bib-data";
import { buildPreviewBlockOptions } from "./hover-preview-block-options";
import { pluginRegistryField } from "../state/plugin-registry";
import { getPlugin } from "../state/plugin-registry-core";
import { findRenderedReference } from "./reference-targeting";
import { findReferenceWidgetContainer } from "./reference-widget";
import {
  buildCitationItemTooltipPlan,
  buildCitationTooltipPlan,
} from "./hover-citation-preview";
import {
  createHoverPreviewContent,
  createHoverPreviewHeader,
} from "./hover-preview-elements";
import { type TooltipPlan } from "./hover-tooltip";
export { normalizeWidePreviewContentForTest } from "./hover-preview-media";
interface BlockPreviewPlan {
  readonly buildBody: () => HTMLElement | null;
  readonly key: string;
  readonly mediaDependencies: LocalMediaDependencies;
}

type CrossrefPreviewVariant = "completion" | "hover";

export function shouldReuseTooltipContent(
  currentPlan: Pick<TooltipPlan, "key"> | null,
  nextPlan: Pick<TooltipPlan, "key">,
  forceRebuild: boolean,
): boolean {
  return !forceRebuild && currentPlan !== null && nextPlan.key === currentPlan.key;
}

export function shouldRebuildHoverPreviewContentForTest(
  currentKey: string | null,
  nextKey: string,
  forceRebuild: boolean,
): boolean {
  return !shouldReuseTooltipContent(
    currentKey === null ? null : { key: currentKey },
    { key: nextKey },
    forceRebuild,
  );
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

function createCrossrefPreviewContainer(
  variant: CrossrefPreviewVariant,
): HTMLElement {
  return createHoverPreviewContent(
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
      renderPreviewBlockContentToDom(
        body,
        text,
        buildPreviewBlockOptions(view, macros, mediaState.imageUrlOverrides),
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
            createHoverPreviewHeader(headerText, macros, CSS.referenceCompletionMeta),
          );
          return container;
        }

        container.appendChild(createHoverPreviewHeader(headerText, macros));
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

  if (resolved.kind === "heading") {
    const headerText =
      resolved.title && resolved.title !== resolved.label
        ? `${resolved.label} ${resolved.title}`
        : resolved.label;

    return {
      buildContent: () => {
        const container = createCrossrefPreviewContainer(variant);
        container.appendChild(createHoverPreviewHeader(headerText, macros));
        return container;
      },
      cacheScope: view.state,
      dependsOnBibliography: false,
      dependsOnMacros: true,
      key: `crossref:heading\0${variant}\0${id}\0${headerText}`,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
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
            createHoverPreviewHeader(resolved.label, macros, CSS.referenceCompletionMeta),
          );
          return container;
        }

        container.appendChild(createHoverPreviewHeader(resolved.label, macros));
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
        createHoverPreviewHeader(`Unresolved: ${id}`, macros, CSS.hoverPreviewUnresolved),
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
  const presentation = createEditorReferencePresentationController(view.state, {
    equationLabels,
  });
  const classification = presentation.classify(id, false);
  return buildCrossrefTooltipPlan(
    view,
    id,
    classification.kind === "crossref"
      ? classification.resolved
      : { kind: "unresolved", label: id },
    "hover",
  ).buildContent();
}

export function buildCrossrefCompletionPreviewContent(
  view: EditorView,
  id: string,
): HTMLElement {
  const equationLabels = view.state.field(documentAnalysisField, false)?.equationById;
  const presentation = createEditorReferencePresentationController(view.state, {
    equationLabels,
  });
  const classification = presentation.classify(id, false);
  return buildCrossrefTooltipPlan(
    view,
    id,
    classification.kind === "crossref"
      ? classification.resolved
      : { kind: "unresolved", label: id },
    "completion",
  ).buildContent();
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
  if (resolved.kind === "citation") {
    return buildCitationItemTooltipPlan(view, id, store);
  }

  if (resolved.kind === "crossref") {
    return buildCrossrefTooltipPlan(view, id, resolved.resolved);
  }

  const macros = view.state.field(mathMacrosField, false) ?? {};
  return {
    buildContent: () => {
      const container = createHoverPreviewContent();
      container.appendChild(
        createHoverPreviewHeader(`Unresolved: ${id}`, macros, CSS.hoverPreviewUnresolved),
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
export function buildTooltipPlanForElement(
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
  const widgetEl = findReferenceWidgetContainer(target);
  if (!widgetEl) return null;

  const ref = findRenderedReference(view, widgetEl);
  if (!ref) return null;

  const { store } = bibData;
  const presentation = createEditorReferencePresentationController(view.state, {
    store,
    cslProcessor: bibData.cslProcessor,
    equationLabels,
  });
  const classifications = ref.ids.map((id) =>
    presentation.classify(id, ref.bracketed),
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
    return buildCitationTooltipPlan(view, ref.ids, store);
  }

  return null;
}
