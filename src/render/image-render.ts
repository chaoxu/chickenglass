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
  buildDecorations,
  cursorInRange,
  pushWidgetDecoration,
  RenderWidget,
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

/** Collect decoration ranges for images outside the cursor, plus tracking metadata. */
function collectImageRangesTracked(view: EditorView): ImageBuildResult {
  const items: Range<Decoration>[] = [];
  const nodeRanges: { from: number; to: number }[] = [];
  const trackedPaths = new Set<string>();
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    const c = tree.cursor();
    scan: for (;;) {
      let descend = false;
      if (c.from <= to && c.to >= from) {
        descend = true;
        if (c.name === "Image") {
          nodeRanges.push({ from: c.from, to: c.to });

          if (cursorInRange(view, c.from, c.to)) {
            descend = false;
          } else {
            const parsed = readImageContent(view, c.node);
            if (parsed) {
              const preview = resolveLocalMediaPreview(view, parsed.src);
              if (preview) {
                trackedPaths.add(preview.resolvedPath);
                pushWidgetDecoration(
                  items,
                  mediaPreviewWidget(parsed.alt, preview),
                  c.from,
                  c.to,
                );
              } else {
                pushWidgetDecoration(
                  items,
                  new ImageWidget(parsed.alt, parsed.src),
                  c.from,
                  c.to,
                );
              }
            }
          }
        }
      }
      if (descend && c.firstChild()) continue;
      for (;;) {
        if (c.nextSibling()) break;
        if (!c.parent()) break scan;
      }
    }
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

  constructor(view: EditorView) {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.nodeRanges = result.nodeRanges;
    this.trackedPaths = result.trackedPaths;
  }

  update(update: ViewUpdate): void {
    // Structural changes require full rebuild
    if (
      update.docChanged ||
      update.viewportChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.rebuild(update.view);
      return;
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

  private rebuild(view: EditorView): void {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.nodeRanges = result.nodeRanges;
    this.trackedPaths = result.trackedPaths;
  }
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = ViewPlugin.fromClass(
  ImageRenderPlugin,
  { decorations: (v) => v.decorations },
);
