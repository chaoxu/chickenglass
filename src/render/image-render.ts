import { type Extension, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  type Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  type VisibleRange,
  buildDecorations,
  cursorInRange,
  diffVisibleRanges,
  isPositionInRanges,
  mergeRanges,
  pushWidgetDecoration,
  RenderWidget,
  snapshotRanges,
} from "./render-utils";
import { imageUrlField } from "./image-url-cache";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";
import {
  resolveLocalMediaPreview,
  type MediaPreviewResult,
} from "./media-preview";
import { CSS } from "../constants/css-classes";

// ── Widgets ───────────────────────────────────────────────────────────────────

/** Widget that renders an inline image. */
export class ImageWidget extends RenderWidget {
  constructor(
    private readonly alt: string,
    private readonly src: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = CSS.imageWrapper;

    const img = document.createElement("img");
    img.className = CSS.image;
    img.src = this.src;
    img.alt = this.alt;
    img.addEventListener("error", () => {
      wrapper.textContent = `[Image: ${this.alt}]`;
      wrapper.className = CSS.imageError;
    });

    wrapper.appendChild(img);
    return wrapper;
  }

  eq(other: ImageWidget): boolean {
    return this.alt === other.alt && this.src === other.src;
  }
}

/** Widget that shows a loading placeholder while a local image is loading. */
export class ImageLoadingWidget extends RenderWidget {
  constructor(private readonly alt: string) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = `${CSS.imageWrapper} ${CSS.imageLoading}`;
    wrapper.textContent = `[Loading image: ${this.alt || "preview"}]`;
    return wrapper;
  }

  eq(other: ImageLoadingWidget): boolean {
    return this.alt === other.alt;
  }
}

/** Widget that wraps a pre-rendered PDF canvas element directly. */
export class PdfCanvasWidget extends RenderWidget {
  constructor(
    private readonly alt: string,
    private readonly path: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = CSS.imageWrapper;

    const canvas = getPdfCanvas(this.path);
    if (canvas) {
      // Clone the canvas so each widget instance owns its own DOM element
      const clone = document.createElement("canvas");
      clone.width = canvas.width;
      clone.height = canvas.height;
      clone.style.maxWidth = "100%";
      clone.style.height = "auto";
      clone.setAttribute("role", "img");
      clone.setAttribute("aria-label", this.alt);
      const ctx = clone.getContext("2d");
      if (ctx) ctx.drawImage(canvas, 0, 0);
      wrapper.appendChild(clone);
    } else {
      wrapper.textContent = `[Image: ${this.alt}]`;
      wrapper.className = CSS.imageError;
    }

    return wrapper;
  }

  eq(other: PdfCanvasWidget): boolean {
    return this.alt === other.alt && this.path === other.path;
  }
}

/** Widget that shows a loading placeholder while a PDF preview is rasterizing. */
export class PdfLoadingWidget extends RenderWidget {
  constructor(private readonly alt: string) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = `${CSS.imageWrapper} ${CSS.imageLoading}`;
    wrapper.textContent = `[Loading PDF: ${this.alt || "preview"}]`;
    return wrapper;
  }

  eq(other: PdfLoadingWidget): boolean {
    return this.alt === other.alt;
  }
}

// ── Syntax helpers ────────────────────────────────────────────────────────────

/** Read alt/src from an Image syntax node. */
function readImageContent(
  view: EditorView,
  node: SyntaxNode,
): { alt: string; src: string } | null {
  const urlNode = node.getChild("URL");
  if (!urlNode) return null;

  const src = view.state.sliceDoc(urlNode.from, urlNode.to);
  if (!src) return null;

  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2
    ? view.state.sliceDoc(marks[0].to, marks[1].from)
    : "";

  return { alt, src };
}

// ── Targeted invalidation helpers ────────────────────────────────────────────

/**
 * Check whether the cursor moved into or out of any image node.
 *
 * Uses the same containment semantics as `cursorInRange` (cursor.from >= from
 * && cursor.to <= to) plus focus state (unfocused => never inside).
 */
export function cursorImageRelationChanged(
  nodeRanges: ReadonlyArray<{ readonly from: number; readonly to: number }>,
  hadFocus: boolean,
  hasFocus: boolean,
  oldFrom: number,
  oldTo: number,
  newFrom: number,
  newTo: number,
): boolean {
  for (const { from, to } of nodeRanges) {
    const wasInside = hadFocus && oldFrom >= from && oldTo <= to;
    const isInside = hasFocus && newFrom >= from && newTo <= to;
    if (wasInside !== isInside) return true;
  }
  return false;
}

/**
 * Check whether any tracked cache path's entry changed between two state
 * snapshots. Uses reference equality on map entries, so only detects
 * actual state transitions (loading->ready, ready->evicted, etc.).
 */
export function trackedCacheChanged(
  trackedPaths: ReadonlySet<string>,
  oldPdfCache: ReadonlyMap<string, unknown>,
  newPdfCache: ReadonlyMap<string, unknown>,
  oldImgCache: ReadonlyMap<string, unknown>,
  newImgCache: ReadonlyMap<string, unknown>,
): boolean {
  if (oldPdfCache !== newPdfCache) {
    for (const path of trackedPaths) {
      if (oldPdfCache.get(path) !== newPdfCache.get(path)) return true;
    }
  }
  if (oldImgCache !== newImgCache) {
    for (const path of trackedPaths) {
      if (oldImgCache.get(path) !== newImgCache.get(path)) return true;
    }
  }
  return false;
}

// ── Decoration builder ───────────────────────────────────────────────────────

/** Metadata collected during decoration build for targeted invalidation. */
interface ImageBuildResult {
  readonly items: Range<Decoration>[];
  /** Positions of all Image nodes in visible ranges (including cursor-adjacent). */
  readonly nodeRanges: ReadonlyArray<{ readonly from: number; readonly to: number }>;
  /** Resolved paths for local images/PDFs currently referenced. */
  readonly trackedPaths: ReadonlySet<string>;
}

/** Map a media preview resolution to the appropriate widget. */
function mediaPreviewWidget(
  alt: string,
  result: MediaPreviewResult,
): RenderWidget {
  switch (result.kind) {
    case "image":
      return new ImageWidget(alt, result.dataUrl);
    case "pdf-canvas":
      return new PdfCanvasWidget(alt, result.resolvedPath);
    case "loading":
      return result.isPdf
        ? new PdfLoadingWidget(alt)
        : new ImageLoadingWidget(alt);
    case "error":
      return new ImageWidget(alt, result.fallbackSrc);
  }
}

/**
 * Collect decoration ranges for images outside the cursor, plus tracking metadata.
 *
 * @param view    The editor view.
 * @param ranges  Explicit ranges to scan (defaults to view.visibleRanges).
 * @param skip    Returns true for node start positions already processed in a
 *                previous viewport — prevents duplicate decorations for nodes
 *                straddling the old/new boundary.
 */
function collectImageRangesTracked(
  view: EditorView,
  ranges?: readonly VisibleRange[],
  skip?: (nodeFrom: number) => boolean,
): ImageBuildResult {
  const items: Range<Decoration>[] = [];
  const nodeRanges: { from: number; to: number }[] = [];
  const trackedPaths = new Set<string>();
  const tree = syntaxTree(view.state);
  const effectiveRanges = ranges ?? view.visibleRanges;

  for (const { from, to } of effectiveRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image") return;

        nodeRanges.push({ from: node.from, to: node.to });

        if (skip?.(node.from) || cursorInRange(view, node.from, node.to)) {
          return false;
        }

        const parsed = readImageContent(view, node.node);
        if (!parsed) return false;

        const preview = resolveLocalMediaPreview(view, parsed.src);
        if (preview) {
          trackedPaths.add(preview.resolvedPath);
          pushWidgetDecoration(
            items,
            mediaPreviewWidget(parsed.alt, preview),
            node.from,
            node.to,
          );
          return false;
        }

        pushWidgetDecoration(
          items,
          new ImageWidget(parsed.alt, parsed.src),
          node.from,
          node.to,
        );
        return false;
      },
    });
  }

  return { items, nodeRanges, trackedPaths };
}

// ── ViewPlugin ───────────────────────────────────────────────────────────────

/**
 * Custom ViewPlugin that narrows image decoration rebuilds to avoid
 * full visible-range rescans on unrelated cursor moves.
 *
 * Tracks image node positions and referenced cache paths from each rebuild.
 * On update, only rebuilds when:
 * - document, viewport, or syntax tree changed (structural)
 * - cursor moved into/out of an image node (cursor adjacency)
 * - a tracked cache path's entry changed (async preview readiness)
 */
class ImageRenderPlugin implements PluginValue {
  decorations: DecorationSet;
  private nodeRanges: ReadonlyArray<{ readonly from: number; readonly to: number }>;
  private trackedPaths: ReadonlySet<string>;
  /** Ranges already processed — used to skip straddling nodes on scroll. */
  private coveredRanges: VisibleRange[];

  constructor(view: EditorView) {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.nodeRanges = result.nodeRanges;
    this.trackedPaths = result.trackedPaths;
    this.coveredRanges = snapshotRanges(view.visibleRanges);
  }

  update(update: ViewUpdate): void {
    // Structural changes that alter the tree require full rebuild
    if (
      update.docChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.rebuild(update.view);
      return;
    }

    // Viewport-only change (scroll): incremental add for newly visible ranges
    if (update.viewportChanged) {
      this.incrementalViewportUpdate(update);
      // Fall through to check selection/cache
    }

    // Selection/focus: rebuild only if cursor moved into/out of an image node
    if (update.selectionSet || update.focusChanged) {
      const hasFocus = update.view.hasFocus;
      const hadFocus = update.focusChanged ? !hasFocus : hasFocus;
      const oldSel = update.startState.selection.main;
      const newSel = update.state.selection.main;
      if (
        cursorImageRelationChanged(
          this.nodeRanges, hadFocus, hasFocus,
          oldSel.from, oldSel.to, newSel.from, newSel.to,
        )
      ) {
        this.rebuild(update.view);
        return;
      }
    }

    // Cache changes: rebuild only if a tracked path's entry changed
    if (
      trackedCacheChanged(
        this.trackedPaths,
        update.startState.field(pdfPreviewField),
        update.state.field(pdfPreviewField),
        update.startState.field(imageUrlField),
        update.state.field(imageUrlField),
      )
    ) {
      this.rebuild(update.view);
    }
  }

  /** Differential viewport update: only process newly-visible ranges. */
  private incrementalViewportUpdate(update: ViewUpdate): void {
    const newRanges = update.view.visibleRanges;
    const newlyVisible = diffVisibleRanges(this.coveredRanges, newRanges);

    if (newlyVisible.length > 0) {
      const skip = (pos: number) => isPositionInRanges(pos, this.coveredRanges);
      const result = collectImageRangesTracked(update.view, newlyVisible, skip);
      if (result.items.length > 0) {
        this.decorations = this.decorations.update({
          add: result.items,
          sort: true,
        });
      }
      // Append new tracking metadata
      this.nodeRanges = [...this.nodeRanges, ...result.nodeRanges];
      this.trackedPaths = new Set([...this.trackedPaths, ...result.trackedPaths]);
      this.coveredRanges = mergeRanges([...this.coveredRanges, ...newlyVisible]);
    }
  }

  private rebuild(view: EditorView): void {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.nodeRanges = result.nodeRanges;
    this.trackedPaths = result.trackedPaths;
    this.coveredRanges = snapshotRanges(view.visibleRanges);
  }
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = ViewPlugin.fromClass(
  ImageRenderPlugin,
  { decorations: (v) => v.decorations },
);
