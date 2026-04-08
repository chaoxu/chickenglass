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
  mapVisibleRanges,
  mergeRanges,
  rangeIntersectsRanges,
  snapshotRanges,
} from "./viewport-diff";
import { buildDecorations, pushWidgetDecoration } from "./decoration-core";
import { RenderWidget } from "./source-widget";
import { imageUrlField } from "./image-url-cache";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";
import {
  collectChangedLocalMediaPaths,
  createLocalMediaDependencies,
  getLocalMediaPreviewDependency,
  resolveLocalMediaPreview,
  trackLocalMediaPreviewDependency,
  type LocalMediaDependencies,
  type LocalMediaPreviewDependency,
  type MediaPreviewResult,
} from "./media-preview";
import { CSS } from "../constants/css-classes";

type ImagePreviewState =
  | { kind: "image"; src: string }
  | { kind: "pdf-canvas"; path: string }
  | { kind: "loading"; isPdf: boolean }
  | { kind: "error"; fallbackSrc: string };

/**
 * Single widget class for all image preview states.
 *
 * Identity is determined by `alt` + original `src`, so cache transitions such
 * as loading -> ready update the existing DOM instead of replacing the slot.
 */
export class ImagePreviewWidget extends RenderWidget {
  constructor(
    readonly alt: string,
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

interface ImageBuildResult {
  readonly items: Range<Decoration>[];
  readonly nodes: ReadonlyArray<ImageNodeInfo>;
}

interface ImageNodeInfo {
  readonly from: number;
  readonly to: number;
  trackedDependency?: LocalMediaPreviewDependency;
}

function mediaDependenciesFromNodes(
  nodes: ReadonlyArray<ImageNodeInfo>,
): LocalMediaDependencies {
  const dependencies = createLocalMediaDependencies();
  for (const node of nodes) {
    if (node.trackedDependency) {
      trackLocalMediaPreviewDependency(dependencies, node.trackedDependency);
    }
  }
  return dependencies;
}

function mapImageNodes(
  nodes: ReadonlyArray<ImageNodeInfo>,
  changes: ChangeSet,
): ImageNodeInfo[] {
  return nodes.map((node) => ({
    from: changes.mapPos(node.from, 1),
    to: changes.mapPos(node.to, -1),
    trackedDependency: node.trackedDependency,
  }));
}

function previewCache(
  state: EditorState,
  field: typeof pdfPreviewField | typeof imageUrlField,
): ReadonlyMap<string, unknown> {
  return state.field(field, false) ?? new Map<string, unknown>();
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
 * Collect visible image decorations and the preview paths they depend on.
 *
 * Rich mode keeps image previews mounted during navigation, so there is no
 * cursor-sensitive hide/show path here. Structure editing is handled elsewhere.
 */
function collectImageRangesTracked(
  view: EditorView,
  ranges: readonly VisibleRange[] = view.visibleRanges,
  skip: (nodeFrom: number) => boolean = () => false,
): ImageBuildResult {
  const items: Range<Decoration>[] = [];
  const nodes: ImageNodeInfo[] = [];
  const tree = syntaxTree(view.state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image") return;
        if (skip(node.from)) return false;

        const trackedNode: ImageNodeInfo = { from: node.from, to: node.to };
        nodes.push(trackedNode);

        const parsed = readImageContent(view, node.node);
        if (!parsed) return false;

        const preview = resolveLocalMediaPreview(view, parsed.src);
        if (preview) {
          trackedNode.trackedDependency = getLocalMediaPreviewDependency(parsed.src, preview);
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

/**
 * Incremental image preview plugin.
 *
 * It owns visible-range tracking and cache-path tracking so ordinary edits and
 * scrolls do not trigger full rescans of every visible image.
 */
class ImageRenderPlugin implements PluginValue {
  decorations: DecorationSet;
  private imageNodes: ReadonlyArray<ImageNodeInfo>;
  private mediaDependencies: LocalMediaDependencies;
  private coveredRanges: VisibleRange[];

  constructor(view: EditorView) {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.imageNodes = result.nodes;
    this.mediaDependencies = mediaDependenciesFromNodes(result.nodes);
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

    if (treeChanged) {
      this.rebuild(update.view);
      return;
    }

    if (update.viewportChanged) {
      this.incrementalViewportUpdate(update);
    }

    const changedPaths = collectChangedLocalMediaPaths(
      this.mediaDependencies,
      previewCache(update.startState, pdfPreviewField),
      previewCache(update.state, pdfPreviewField),
      previewCache(update.startState, imageUrlField),
      previewCache(update.state, imageUrlField),
    );
    if (changedPaths.size > 0) {
      this.incrementalCacheUpdate(update.view, changedPaths);
    }
  }

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
    this.mediaDependencies = mediaDependenciesFromNodes(nextImageNodes);
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
    this.mediaDependencies = mediaDependenciesFromNodes(this.imageNodes);
    this.coveredRanges = currentVisibleRanges;
  }

  private incrementalCacheUpdate(
    view: EditorView,
    changedPaths: ReadonlySet<string>,
  ): void {
    const dirtyNodes = this.imageNodes.filter(
      (node) =>
        node.trackedDependency !== undefined &&
        changedPaths.has(node.trackedDependency.resolvedPath),
    );
    if (dirtyNodes.length === 0) return;

    const rebuildRanges = mergeRanges(
      dirtyNodes.map((node) => ({ from: node.from, to: node.to })),
    );
    const keptNodes = this.imageNodes.filter(
      (node) =>
        node.trackedDependency === undefined ||
        !changedPaths.has(node.trackedDependency.resolvedPath),
    );

    let nextDecorations = this.decorations;
    for (const range of rebuildRanges) {
      nextDecorations = nextDecorations.update({
        filterFrom: range.from,
        filterTo: range.to,
        filter: (from, to) => !rangeIntersectsRanges(from, to, [range]),
      });
    }

    const retainedStarts = new Set(keptNodes.map((node) => node.from));
    const result = collectImageRangesTracked(
      view,
      rebuildRanges,
      (nodeFrom) => retainedStarts.has(nodeFrom),
    );
    if (result.items.length > 0) {
      nextDecorations = nextDecorations.update({
        add: result.items,
        sort: true,
      });
    }

    this.decorations = nextDecorations;
    this.imageNodes = [...keptNodes, ...result.nodes]
      .sort((a, b) => a.from - b.from || a.to - b.to);
    this.mediaDependencies = mediaDependenciesFromNodes(this.imageNodes);
  }

  rebuild(view: EditorView): void {
    const result = collectImageRangesTracked(view);
    this.decorations = buildDecorations(result.items);
    this.imageNodes = result.nodes;
    this.mediaDependencies = mediaDependenciesFromNodes(result.nodes);
    this.coveredRanges = snapshotRanges(view.visibleRanges);
  }
}

export const imageRenderPlugin: Extension = ViewPlugin.fromClass(
  ImageRenderPlugin,
  { decorations: (value) => value.decorations },
);
