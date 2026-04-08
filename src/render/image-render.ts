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
import { RenderWidget } from "./widget-core";
import { imageUrlField } from "./image-url-cache";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";
import {
  resolveLocalMediaPreview,
  type MediaPreviewResult,
} from "./media-preview";
import { CSS } from "../constants/css-classes";

// ── Image preview state ──────────────────────────────────────────────────────

type ImagePreviewState =
  | { kind: "image"; src: string }
  | { kind: "pdf-canvas"; path: string }
  | { kind: "loading"; isPdf: boolean }
  | { kind: "error"; fallbackSrc: string };

// ── Unified widget ──────────────────────────────────────────────────────────

/**
 * Single widget class for all image preview states.
 *
 * Identity is determined by `alt` + original `src` — when the cache state
 * changes (loading → ready), CM6 calls `updateDOM()` instead of destroying
 * and recreating the DOM element. This keeps the image inside a stable slot
 * and prevents topology-change-driven geometry churn (#1015).
 */
export class ImagePreviewWidget extends RenderWidget {
  constructor(
    readonly alt: string,
    /** Original markdown src — used as stable identity across state changes. */
    readonly src: string,
    readonly state: ImagePreviewState,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    this.renderInto(wrapper);
    return wrapper;
  }

  /** Position-stable identity: same alt+src → updateDOM, not recreate. */
  eq(other: ImagePreviewWidget): boolean {
    return this.alt === other.alt && this.src === other.src;
  }

  updateDOM(dom: HTMLElement): boolean {
    dom.textContent = "";
    this.renderInto(dom);
    this.setSourceRangeAttrs(dom);
    return true;
  }

  private renderInto(wrapper: HTMLElement): void {
    switch (this.state.kind) {
      case "image": {
        wrapper.className = CSS.imageWrapper;
        const img = document.createElement("img");
        img.className = CSS.image;
        img.src = this.state.src;
        img.alt = this.alt;
        img.addEventListener("error", () => {
          wrapper.textContent = `[Image: ${this.alt}]`;
          wrapper.className = CSS.imageError;
        });
        wrapper.appendChild(img);
        break;
      }
      case "pdf-canvas": {
        const canvas = getPdfCanvas(this.state.path);
        if (canvas) {
          wrapper.className = CSS.imageWrapper;
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
          wrapper.className = CSS.imageError;
          wrapper.textContent = `[Image: ${this.alt}]`;
        }
        break;
      }
      case "loading":
        wrapper.className = `${CSS.imageWrapper} ${CSS.imageLoading}`;
        wrapper.textContent = this.state.isPdf
          ? `[Loading PDF: ${this.alt || "preview"}]`
          : `[Loading image: ${this.alt || "preview"}]`;
        break;
      case "error": {
        wrapper.className = CSS.imageWrapper;
        const img = document.createElement("img");
        img.className = CSS.image;
        img.src = this.state.fallbackSrc;
        img.alt = this.alt;
        img.addEventListener("error", () => {
          wrapper.textContent = `[Image: ${this.alt}]`;
          wrapper.className = CSS.imageError;
        });
        wrapper.appendChild(img);
        break;
      }
    }
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

function previewCache(
  state: EditorState,
  field: typeof pdfPreviewField | typeof imageUrlField,
): ReadonlyMap<string, unknown> {
  return state.field(field, false) ?? new Map<string, unknown>();
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
  src: string,
  result: MediaPreviewResult,
): RenderWidget {
  switch (result.kind) {
    case "image":
      return new ImagePreviewWidget(alt, src, { kind: "image", src: result.dataUrl });
    case "pdf-canvas":
      return new ImagePreviewWidget(alt, src, { kind: "pdf-canvas", path: result.resolvedPath });
    case "loading":
      return new ImagePreviewWidget(alt, src, { kind: "loading", isPdf: result.isPdf });
    case "error":
      return new ImagePreviewWidget(alt, src, { kind: "error", fallbackSrc: result.fallbackSrc });
  }
}

/**
 * Collect decoration ranges for visible images, plus tracking metadata.
 *
 * In the stable-shell experiment we keep image previews mounted during
 * ordinary navigation. Entering an image's source range should not flip the
 * line back to raw markdown; editing image syntax will later become an
 * explicit structure interaction.
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

        const parsed = readImageContent(view, node.node);
        if (!parsed) return false;

        const preview = resolveLocalMediaPreview(view, parsed.src);
        if (preview) {
          trackedNode.trackedPath = preview.resolvedPath;
          pushWidgetDecoration(
            items,
            mediaPreviewWidget(parsed.alt, parsed.src, preview),
            node.from,
            node.to,
          );
          return false;
        }

        pushWidgetDecoration(
          items,
          new ImagePreviewWidget(parsed.alt, parsed.src, { kind: "image", src: parsed.src }),
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

    // Cache changes: rebuild only if a tracked path's entry changed
    if (
      trackedCacheChanged(
        this.trackedPaths,
        previewCache(update.startState, pdfPreviewField),
        previewCache(update.state, pdfPreviewField),
        previewCache(update.startState, imageUrlField),
        previewCache(update.state, imageUrlField),
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

/** CM6 extension that renders inline images as stable previews in rich mode. */
export const imageRenderPlugin: Extension = ViewPlugin.fromClass(
  ImageRenderPlugin,
  { decorations: (v) => v.decorations },
);
