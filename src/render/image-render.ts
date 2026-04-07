import { type ChangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  type Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  type VisibleRange,
  diffVisibleRanges,
  mergeRanges,
  snapshotRanges,
} from "./viewport-diff";
import { buildDecorations, pushWidgetDecoration } from "./decoration-core";
import { cursorInRange } from "./node-collection";
import { RenderWidget } from "./widget-core";
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
  /** Visible Image nodes, with tracked preview path when one is active. */
  readonly nodes: ReadonlyArray<ImageNodeInfo>;
}

interface ImageNodeInfo {
  from: number;
  to: number;
  trackedPath?: string;
}

function trackedPathsFromNodes(
  nodes: ReadonlyArray<ImageNodeInfo>,
): ReadonlySet<string> {
  const trackedPaths = new Set<string>();
  for (const node of nodes) {
    if (node.trackedPath) trackedPaths.add(node.trackedPath);
  }
  return trackedPaths;
}

function mapImageNodes(
  nodes: ReadonlyArray<ImageNodeInfo>,
  changes: ChangeSet,
): ImageNodeInfo[] {
  return nodes.map((node) => ({
    from: changes.mapPos(node.from, 1),
    to: changes.mapPos(node.to, -1),
    trackedPath: node.trackedPath,
  }));
}

function mapVisibleRanges(
  ranges: readonly VisibleRange[],
  changes: ChangeSet,
): VisibleRange[] {
  return mergeRanges(
    ranges.map((range) => {
      const from = changes.mapPos(range.from, 1);
      const to = changes.mapPos(range.to, -1);
      return { from, to: Math.max(from, to) };
    }),
  );
}

function rangeIntersectsRanges(
  from: number,
  to: number,
  ranges: readonly VisibleRange[],
): boolean {
  for (const range of ranges) {
    if (from < range.to && to > range.from) return true;
    if (range.from >= to) break;
  }
  return false;
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

/**
 * Collect decoration ranges for images outside the cursor, plus tracking metadata.
 *
 * @param view    The editor view.
 * @param ranges  Explicit ranges to scan (defaults to view.visibleRanges).
 * @param skip    Returns true for node start positions already processed in a
 *                previous viewport — prevents duplicate tracking/decorations
 *                for nodes straddling the old/new boundary.
 */
function collectImageRangesTracked(
  view: EditorView,
  ranges?: readonly VisibleRange[],
  skip?: (nodeFrom: number) => boolean,
): ImageBuildResult {
  const items: Range<Decoration>[] = [];
  const nodes: ImageNodeInfo[] = [];
  const tree = syntaxTree(view.state);
  const effectiveRanges = ranges ?? view.visibleRanges;

  for (const { from, to } of effectiveRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image") return;
        if (skip?.(node.from)) return false;

        const trackedNode: ImageNodeInfo = { from: node.from, to: node.to };
        nodes.push(trackedNode);

        if (cursorInRange(view, node.from, node.to)) {
          return false;
        }

        const parsed = readImageContent(view, node.node);
        if (!parsed) return false;

        const preview = resolveLocalMediaPreview(view, parsed.src);
        if (preview) {
          trackedNode.trackedPath = preview.resolvedPath;
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

  return { items, nodes };
}

// ── ViewPlugin ───────────────────────────────────────────────────────────────

/**
 * Custom ViewPlugin that narrows image decoration rebuilds to avoid
 * full visible-range rescans on unrelated edits and cursor moves.
 *
 * Tracks image node positions and referenced cache paths from each rebuild.
 * On update, only rebuilds when:
 * - document changes touch an image node or newly-visible fragment
 * - viewport or syntax tree changes require a rebuild path
 * - cursor moved into/out of an image node (cursor adjacency)
 * - a tracked cache path's entry changed (async preview readiness)
 */
class ImageRenderPlugin implements PluginValue {
  decorations: DecorationSet;
  private imageNodes: ReadonlyArray<ImageNodeInfo>;
  private trackedPaths: ReadonlySet<string>;
  /** Ranges already processed — used to skip straddling nodes on scroll. */
  private coveredRanges: VisibleRange[];

  constructor(view: EditorView) {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.imageNodes = result.nodes;
    this.trackedPaths = trackedPathsFromNodes(result.nodes);
    this.coveredRanges = snapshotRanges(view.visibleRanges);
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);

    if (update.docChanged) {
      if (treeChanged && !syntaxTreeAvailable(update.state, update.state.doc.length)) {
        this.rebuild(update.view);
      } else {
        this.incrementalDocUpdate(update);
      }
      return;
    }

    // Structural changes that alter the tree require full rebuild
    if (treeChanged) {
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
          this.imageNodes, hadFocus, hasFocus,
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
    const previousCoveredRanges = this.coveredRanges;
    const currentVisibleRanges = snapshotRanges(update.view.visibleRanges);
    const evictedRanges = diffVisibleRanges(currentVisibleRanges, previousCoveredRanges);
    const newlyVisible = diffVisibleRanges(previousCoveredRanges, currentVisibleRanges);

    if (evictedRanges.length === 0 && newlyVisible.length === 0) {
      this.coveredRanges = currentVisibleRanges;
      return;
    }

    let nextDecorations = this.decorations;
    const nextImageNodes = evictedRanges.length > 0
      ? this.imageNodes.filter((node) =>
          rangeIntersectsRanges(node.from, node.to, currentVisibleRanges)
        )
      : [...this.imageNodes];

    if (evictedRanges.length > 0) {
      for (const range of evictedRanges) {
        nextDecorations = nextDecorations.update({
          filterFrom: range.from,
          filterTo: range.to,
          filter: (from, to) => rangeIntersectsRanges(from, to, currentVisibleRanges),
        });
      }
    }

    if (newlyVisible.length > 0) {
      const retainedStarts = new Set(nextImageNodes.map((node) => node.from));
      const result = collectImageRangesTracked(
        update.view,
        newlyVisible,
        (nodeFrom) => retainedStarts.has(nodeFrom),
      );
      if (result.items.length > 0) {
        nextDecorations = nextDecorations.update({
          add: result.items,
          sort: true,
        });
      }
      if (result.nodes.length > 0) {
        nextImageNodes.push(...result.nodes);
        nextImageNodes.sort((a, b) => a.from - b.from || a.to - b.to);
      }
    }

    this.decorations = nextDecorations;
    this.imageNodes = nextImageNodes;
    this.trackedPaths = trackedPathsFromNodes(nextImageNodes);
    this.coveredRanges = currentVisibleRanges;
  }

  private incrementalDocUpdate(update: ViewUpdate): void {
    const mappedCoveredRanges = mapVisibleRanges(this.coveredRanges, update.changes);
    const currentVisibleRanges = snapshotRanges(update.view.visibleRanges);
    const dirtyRanges = computeDirtyImageRanges(
      update.startState,
      update.state,
      update.changes,
    ).filter((range) => rangeIntersectsRanges(range.from, range.to, currentVisibleRanges));
    const missingVisible = diffVisibleRanges(mappedCoveredRanges, currentVisibleRanges);
    const rebuildRanges = mergeRanges([...dirtyRanges, ...missingVisible]);

    const keptNodes = mapImageNodes(this.imageNodes, update.changes)
      .filter((node) => rangeIntersectsRanges(node.from, node.to, currentVisibleRanges))
      .filter((node) => !rangeIntersectsRanges(node.from, node.to, dirtyRanges));

    let nextDecorations = this.decorations.map(update.changes).update({
      filterFrom: 0,
      filterTo: update.state.doc.length,
      filter: (from, to) =>
        rangeIntersectsRanges(from, to, currentVisibleRanges) &&
        !rangeIntersectsRanges(from, to, dirtyRanges),
    });

    if (rebuildRanges.length > 0) {
      const retainedStarts = new Set(keptNodes.map((node) => node.from));
      const result = collectImageRangesTracked(
        update.view,
        rebuildRanges,
        (nodeFrom) => retainedStarts.has(nodeFrom),
      );
      if (result.items.length > 0) {
        nextDecorations = nextDecorations.update({
          add: result.items,
          sort: true,
        });
      }
      this.imageNodes = [...keptNodes, ...result.nodes]
        .sort((a, b) => a.from - b.from || a.to - b.to);
    } else {
      this.imageNodes = keptNodes;
    }

    this.decorations = nextDecorations;
    this.trackedPaths = trackedPathsFromNodes(this.imageNodes);
    this.coveredRanges = currentVisibleRanges;
  }

  private rebuild(view: EditorView): void {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.imageNodes = result.nodes;
    this.trackedPaths = trackedPathsFromNodes(result.nodes);
    this.coveredRanges = snapshotRanges(view.visibleRanges);
  }
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = ViewPlugin.fromClass(
  ImageRenderPlugin,
  { decorations: (v) => v.decorations },
);
