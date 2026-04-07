import { type ChangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  type Decoration,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  type VisibleRange,
  mapVisibleRanges,
  mergeRanges,
} from "./viewport-diff";
import { pushWidgetDecoration } from "./decoration-core";
import { cursorInRange } from "./node-collection";
import { RenderWidget } from "./widget-core";
import { imageUrlField } from "./image-url-cache";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";
import {
  resolveLocalMediaPreview,
  type MediaPreviewResult,
} from "./media-preview";
import { createCursorSensitiveViewPlugin } from "./view-plugin-factories";
import { CSS } from "../constants/css-classes";
import { documentPathFacet } from "../lib/types";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";
import { resolveProjectPathFromDocument } from "../lib/project-paths";

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
  if (oldPdfCache === newPdfCache && oldImgCache === newImgCache) {
    return false;
  }
  for (const path of trackedPaths) {
    if (cacheEntryChanged(path, oldPdfCache, newPdfCache, oldImgCache, newImgCache)) {
      return true;
    }
  }
  return false;
}

function cacheEntryChanged(
  path: string,
  oldPdfCache: ReadonlyMap<string, unknown>,
  newPdfCache: ReadonlyMap<string, unknown>,
  oldImgCache: ReadonlyMap<string, unknown>,
  newImgCache: ReadonlyMap<string, unknown>,
): boolean {
  return (
    oldPdfCache.get(path) !== newPdfCache.get(path) ||
    oldImgCache.get(path) !== newImgCache.get(path)
  );
}

function collectImageRangesInState(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
  pushRange: (from: number, to: number) => void,
): void {
  syntaxTree(state).iterate({
    from: rangeFrom,
    to: rangeTo,
    enter(node) {
      if (node.name !== "Image") return;
      pushRange(node.from, node.to);
      return false;
    },
  });
}

function collectSelectionImageRanges(
  state: EditorState,
  pushRange: (from: number, to: number) => void,
): void {
  const selection = state.selection.main;
  const tree = syntaxTree(state);
  const seen = new Set<string>();
  const positions = selection.from === selection.to
    ? [selection.from]
    : [selection.from, selection.to];

  for (const pos of positions) {
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(pos, side);
      while (true) {
        if (node.name === "Image" && selection.from >= node.from && selection.to <= node.to) {
          const key = `${node.from}:${node.to}`;
          if (!seen.has(key)) {
            seen.add(key);
            pushRange(node.from, node.to);
          }
          break;
        }
        const parent = node.parent;
        if (!parent) break;
        node = parent;
      }
    }
  }
}

function mapNodeRange(
  changes: ChangeSet,
  from: number,
  to: number,
): VisibleRange {
  const mappedFrom = changes.mapPos(from, 1);
  const mappedTo = changes.mapPos(to, -1);
  return { from: mappedFrom, to: Math.max(mappedFrom, mappedTo) };
}

function computeDirtyImageRanges(
  startState: EditorState,
  state: EditorState,
  changes: ChangeSet,
): VisibleRange[] {
  const dirtyRanges: VisibleRange[] = [];

  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    dirtyRanges.push({ from: fromB, to: toB });

    collectImageRangesInState(startState, fromA, toA, (nodeFrom, nodeTo) => {
      dirtyRanges.push(mapNodeRange(changes, nodeFrom, nodeTo));
    });

    collectImageRangesInState(state, fromB, toB, (nodeFrom, nodeTo) => {
      dirtyRanges.push({ from: nodeFrom, to: nodeTo });
    });
  });

  collectSelectionImageRanges(startState, (nodeFrom, nodeTo) => {
    dirtyRanges.push(mapNodeRange(changes, nodeFrom, nodeTo));
  });
  collectSelectionImageRanges(state, (nodeFrom, nodeTo) => {
    dirtyRanges.push({ from: nodeFrom, to: nodeTo });
  });

  return mergeRanges(dirtyRanges);
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

/** Collect image decorations for visible ranges outside the cursor. */
function collectImageItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image") return;
        if (skip(node.from)) return false;

        if (cursorInRange(view, node.from, node.to)) {
          return false;
        }

        const parsed = readImageContent(view, node.node);
        if (!parsed) return false;

        const preview = resolveLocalMediaPreview(view, parsed.src);
        if (preview) {
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

  return items;
}

function resolveTrackedPreviewPath(
  view: EditorView,
  src: string,
): string | null {
  if (!isPdfTarget(src) && !isRelativeFilePath(src)) {
    return null;
  }
  return resolveProjectPathFromDocument(view.state.facet(documentPathFacet), src);
}

interface TrackedImageRange extends VisibleRange {
  readonly trackedPath: string;
}

function collectVisibleTrackedPreviewRanges(
  view: EditorView,
  ranges: readonly VisibleRange[] = view.visibleRanges,
): TrackedImageRange[] {
  const trackedRanges: TrackedImageRange[] = [];
  const seen = new Set<number>();

  for (const { from, to } of ranges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image" || seen.has(node.from)) return;
        seen.add(node.from);
        if (cursorInRange(view, node.from, node.to)) return false;

        const parsed = readImageContent(view, node.node);
        if (!parsed) return false;

        const trackedPath = resolveTrackedPreviewPath(view, parsed.src);
        if (!trackedPath) return false;

        trackedRanges.push({ from: node.from, to: node.to, trackedPath });
        return false;
      },
    });
  }

  return trackedRanges;
}

function collectSelectionImageContextRanges(
  state: EditorState,
  hasFocus: boolean,
): VisibleRange[] {
  if (!hasFocus) return [];
  const ranges: VisibleRange[] = [];
  collectSelectionImageRanges(state, (from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
}

function rangesEqual(
  left: readonly VisibleRange[],
  right: readonly VisibleRange[],
): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = new Set(left.map((range) => `${range.from}:${range.to}`));
  if (leftKeys.size !== right.length) return false;
  return right.every((range) => leftKeys.has(`${range.from}:${range.to}`));
}

function computeImageSelectionChangeRanges(update: ViewUpdate): VisibleRange[] {
  if (!update.selectionSet && !update.focusChanged) return [];

  const hasFocus = update.view.hasFocus;
  const hadFocus = update.focusChanged ? !hasFocus : hasFocus;
  const previousRanges = collectSelectionImageContextRanges(update.startState, hadFocus);
  const mappedPreviousRanges = update.docChanged
    ? mapVisibleRanges(previousRanges, update.changes)
    : previousRanges;
  const nextRanges = collectSelectionImageContextRanges(update.state, hasFocus);

  if (rangesEqual(mappedPreviousRanges, nextRanges)) return [];
  return mergeRanges([...mappedPreviousRanges, ...nextRanges]);
}

function computeImageCacheChangeRanges(update: ViewUpdate): VisibleRange[] {
  if (update.docChanged) return [];

  const oldPdfCache = update.startState.field(pdfPreviewField);
  const newPdfCache = update.state.field(pdfPreviewField);
  const oldImgCache = update.startState.field(imageUrlField);
  const newImgCache = update.state.field(imageUrlField);
  const trackedRanges = collectVisibleTrackedPreviewRanges(update.view);

  if (trackedRanges.length === 0) return [];

  const trackedPaths = new Set(trackedRanges.map((range) => range.trackedPath));
  if (!trackedCacheChanged(trackedPaths, oldPdfCache, newPdfCache, oldImgCache, newImgCache)) {
    return [];
  }

  return mergeRanges(
    trackedRanges
      .filter((range) =>
        cacheEntryChanged(range.trackedPath, oldPdfCache, newPdfCache, oldImgCache, newImgCache)
      )
      .map(({ from, to }) => ({ from, to })),
  );
}

function computeImageContextChangeRanges(update: ViewUpdate): readonly VisibleRange[] {
  return mergeRanges([
    ...computeImageSelectionChangeRanges(update),
    ...computeImageCacheChangeRanges(update),
  ]);
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = createCursorSensitiveViewPlugin(
  collectImageItems,
  {
    contextChangeRanges: computeImageContextChangeRanges,
    docChangeRanges: (update) =>
      computeDirtyImageRanges(update.startState, update.state, update.changes),
    extraRebuildCheck: (update) =>
      update.docChanged &&
      syntaxTree(update.state) !== syntaxTree(update.startState) &&
      !syntaxTreeAvailable(update.state, update.state.doc.length),
  },
);
