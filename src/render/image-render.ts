import {
  type ChangeSet,
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  pushBlockWidgetDecoration,
  pushWidgetDecoration,
} from "./decoration-core";
import { RenderWidget } from "./source-widget";
import {
  clearActiveFenceGuideClasses,
  syncActiveFenceGuideClasses,
} from "./source-widget";
import { ShellWidget } from "./shell-widget";
import { imageUrlField } from "../state/image-url";
import { pdfPreviewField } from "../state/pdf-preview";
import { getPdfCanvas } from "./pdf-preview-cache";
import {
  clearBlockWidgetHeightBinding,
  estimatedBlockWidgetHeight,
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";
import {
  collectChangedLocalMediaPaths,
  getLocalMediaPreviewDependency,
  resolveLocalMediaPreview,
  resolveLocalMediaPreviewFromState,
  type LocalMediaDependencies,
  type LocalMediaPreviewDependency,
  type MediaPreviewResult,
} from "./media-preview";
import { CSS } from "../constants/css-classes";
import { createChangeChecker } from "../state/change-detection";
import {
  dirtyRangesFromChanges,
  expandChangeRangeToLines,
  rangeIntersectsDirtyRanges,
  type DirtyRange,
} from "./incremental-dirty-ranges";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  type ActiveImageSourceTarget,
  activeSourceTargetsEqual,
  addActiveImageSourceDecorations,
  getActiveImageSourceTarget,
  isStandaloneImageLine,
  mapActiveSourceTargetThroughChanges,
} from "./image-source-reveal";
import { measureSync } from "../lib/perf";

type ImagePreviewState =
  | { kind: "image"; src: string }
  | { kind: "pdf-canvas"; path: string }
  | { kind: "loading"; isPdf: boolean }
  | { kind: "error"; fallbackSrc: string };

const imagePreviewHeightCache = new Map<string, number>();
const INITIAL_IMAGE_PREVIEW_SCAN_LIMIT = 20_000;
const IMAGE_PREVIEW_PREFETCH_MARGIN = 4_000;

/**
 * Single widget class for all image preview states.
 *
 * Identity includes the preview state so CM6 does not treat a loading widget
 * as equivalent to its later ready/error version and keep stale DOM mounted.
 */
export class ImagePreviewWidget extends ShellWidget {
  private readonly measuredHeightBinding: BlockWidgetHeightBinding = {
    resizeObserver: null,
    resizeMeasureFrame: null,
  };

  constructor(
    readonly alt: string,
    readonly src: string,
    readonly state: ImagePreviewState,
    readonly isBlock = false,
  ) {
    super();
  }

  override updateSourceRange(from: number, to: number): void {
    super.updateSourceRange(from, to);
    if (!this.isBlock) {
      this.shellSurfaceFrom = -1;
      this.shellSurfaceTo = -1;
    }
  }

  private stateKey(): string {
    switch (this.state.kind) {
      case "image":
        return `image:${this.state.src}`;
      case "pdf-canvas":
        return `pdf-canvas:${this.state.path}`;
      case "loading":
        return `loading:${this.state.isPdf ? "pdf" : "image"}`;
      case "error":
        return `error:${this.state.fallbackSrc}`;
    }
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement(this.isBlock ? "div" : "span");
    this.renderInto(wrapper);
    return wrapper;
  }

  private heightBinding(): BlockWidgetHeightBinding {
    return this.measuredHeightBinding;
  }

  private observeMeasuredHeight(
    wrapper: HTMLElement,
    view: EditorView,
  ): void {
    observeBlockWidgetHeight(
      this.heightBinding(),
      wrapper,
      view,
      imagePreviewHeightCache,
      this.src,
    );
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImagePreviewWidget &&
      this.alt === other.alt &&
      this.src === other.src &&
      this.isBlock === other.isBlock &&
      this.stateKey() === other.stateKey()
    );
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncWidgetAttrs(el);
    if (this.isBlock) {
      el.dataset.activeFenceGuides = "true";
      syncActiveFenceGuideClasses(el, view, this.sourceFrom, this.sourceTo);
    } else {
      delete el.dataset.activeFenceGuides;
      clearActiveFenceGuideClasses(el);
    }
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    if (view) {
      this.observeMeasuredHeight(el, view);
    }
    return el;
  }

  updateDOM(dom: HTMLElement, view?: EditorView, from?: WidgetType): boolean {
    const expectedTag = this.isBlock ? "DIV" : "SPAN";
    if (dom.tagName !== expectedTag) return false;
    if (from instanceof ImagePreviewWidget) {
      from.clearMeasuredHeight();
    }
    dom.textContent = "";
    this.renderInto(dom);
    this.syncWidgetAttrs(dom);
    if (this.isBlock) {
      dom.dataset.activeFenceGuides = "true";
      syncActiveFenceGuideClasses(dom, view, this.sourceFrom, this.sourceTo);
    } else {
      delete dom.dataset.activeFenceGuides;
      clearActiveFenceGuideClasses(dom);
    }
    if (view) {
      this.observeMeasuredHeight(dom, view);
    }
    return true;
  }

  private clearMeasuredHeight(): void {
    clearBlockWidgetHeightBinding(this.heightBinding());
  }

  destroy(_dom?: HTMLElement): void {
    this.clearMeasuredHeight();
  }

  get estimatedHeight(): number {
    const cached = estimatedBlockWidgetHeight(imagePreviewHeightCache, this.src);
    if (cached >= 0) return cached;
    return this.state.kind === "loading" ? 100 : -1;
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
  state: EditorState,
  node: SyntaxNode,
): { alt: string; src: string } | null {
  const urlNode = node.getChild("URL");
  if (!urlNode) return null;

  const src = state.sliceDoc(urlNode.from, urlNode.to);
  if (!src) return null;

  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2
    ? state.sliceDoc(marks[0].to, marks[1].from)
    : "";

  return { alt, src };
}

function mediaPreviewWidget(
  alt: string,
  src: string,
  result: MediaPreviewResult,
  isBlock: boolean,
): RenderWidget {
  switch (result.kind) {
    case "image":
      return new ImagePreviewWidget(alt, src, { kind: "image", src: result.dataUrl }, isBlock);
    case "pdf-canvas":
      return new ImagePreviewWidget(alt, src, { kind: "pdf-canvas", path: result.resolvedPath }, isBlock);
    case "loading":
      return new ImagePreviewWidget(alt, src, { kind: "loading", isPdf: result.isPdf }, isBlock);
    case "error":
      return new ImagePreviewWidget(alt, src, { kind: "error", fallbackSrc: result.fallbackSrc }, isBlock);
  }
}

interface ImageNodeInfo {
  readonly from: number;
  readonly to: number;
  readonly alt: string;
  readonly src: string;
  readonly isBlock: boolean;
  readonly preview: MediaPreviewResult | null;
}

interface LocalMediaDependencyCounts {
  readonly imagePaths: Map<string, number>;
  readonly pdfPaths: Map<string, number>;
}

type ImageInfosByResolvedPath = ReadonlyMap<string, readonly ImageNodeInfo[]>;

interface ImageDecorationState {
  readonly decorations: DecorationSet;
  readonly mediaDependencies: LocalMediaDependencies;
  readonly dependencyCounts: LocalMediaDependencyCounts;
  readonly infosByResolvedPath: ImageInfosByResolvedPath;
  readonly activeSource: ActiveImageSourceTarget | null;
}

function createDependencyCounts(): LocalMediaDependencyCounts {
  return {
    imagePaths: new Map<string, number>(),
    pdfPaths: new Map<string, number>(),
  };
}

function cloneDependencyCounts(
  counts: LocalMediaDependencyCounts,
): LocalMediaDependencyCounts {
  return {
    imagePaths: new Map(counts.imagePaths),
    pdfPaths: new Map(counts.pdfPaths),
  };
}

function dependencyCountsToDependencies(
  counts: LocalMediaDependencyCounts,
): LocalMediaDependencies {
  return {
    imagePaths: new Set(counts.imagePaths.keys()),
    pdfPaths: new Set(counts.pdfPaths.keys()),
  };
}

function adjustDependencyCount(
  counts: Map<string, number>,
  path: string,
  delta: number,
): void {
  const next = (counts.get(path) ?? 0) + delta;
  if (next <= 0) {
    counts.delete(path);
    return;
  }
  counts.set(path, next);
}

function applyDependencyDelta(
  counts: LocalMediaDependencyCounts,
  dependency: LocalMediaPreviewDependency | null,
  delta: number,
): void {
  if (!dependency) return;
  const target = dependency.cacheKind === "pdf"
    ? counts.pdfPaths
    : counts.imagePaths;
  adjustDependencyCount(target, dependency.resolvedPath, delta);
}

function getImageDependency(
  info: ImageNodeInfo,
): LocalMediaPreviewDependency | null {
  return info.preview
    ? getLocalMediaPreviewDependency(info.src, info.preview)
    : null;
}

function imageInfoKey(info: ImageNodeInfo): string {
  return `${info.from}:${info.to}`;
}

function addImageInfoToPathIndex(
  index: Map<string, ImageNodeInfo[]>,
  info: ImageNodeInfo,
): void {
  const dependency = getImageDependency(info);
  if (!dependency) return;
  const infos = index.get(dependency.resolvedPath);
  if (infos) {
    infos.push(info);
    return;
  }
  index.set(dependency.resolvedPath, [info]);
}

function buildImageInfoPathIndex(
  infos: readonly ImageNodeInfo[],
): ImageInfosByResolvedPath {
  const index = new Map<string, ImageNodeInfo[]>();
  for (const info of infos) {
    addImageInfoToPathIndex(index, info);
  }
  return index;
}

function mapImageInfoThroughChanges(
  info: ImageNodeInfo,
  state: EditorState,
  changes: ChangeSet,
): ImageNodeInfo {
  const from = Math.max(
    0,
    Math.min(changes.mapPos(info.from, 1), state.doc.length),
  );
  const to = Math.max(
    0,
    Math.min(changes.mapPos(info.to, -1), state.doc.length),
  );
  return {
    ...info,
    from,
    to: Math.max(from, to),
  };
}

function mapImageInfoPathIndexThroughChanges(
  index: ImageInfosByResolvedPath,
  state: EditorState,
  changes: ChangeSet,
  removedInfoKeys: ReadonlySet<string>,
): Map<string, ImageNodeInfo[]> {
  const next = new Map<string, ImageNodeInfo[]>();
  for (const infos of index.values()) {
    for (const info of infos) {
      if (removedInfoKeys.has(imageInfoKey(info))) continue;
      addImageInfoToPathIndex(
        next,
        mapImageInfoThroughChanges(info, state, changes),
      );
    }
  }
  return next;
}

function collectImageNodeInfosForResolvedPathsFromIndex(
  index: ImageInfosByResolvedPath,
  resolvedPaths: ReadonlySet<string>,
): ImageNodeInfo[] {
  if (resolvedPaths.size === 0) return [];
  const infos: ImageNodeInfo[] = [];
  const seen = new Set<string>();
  for (const path of resolvedPaths) {
    for (const info of index.get(path) ?? []) {
      const key = imageInfoKey(info);
      if (seen.has(key)) continue;
      seen.add(key);
      infos.push(info);
    }
  }
  return infos;
}

function refreshImageNodeInfoPreview(
  state: EditorState,
  info: ImageNodeInfo,
): ImageNodeInfo {
  return {
    ...info,
    preview: resolveLocalMediaPreviewFromState(state, info.src),
  };
}

function buildImageNodeInfo(
  state: EditorState,
  node: SyntaxNode,
): ImageNodeInfo | null {
  const parsed = readImageContent(state, node);
  if (!parsed) return null;

  return {
    from: node.from,
    to: node.to,
    alt: parsed.alt,
    src: parsed.src,
    isBlock: isStandaloneImageLine(state, node.from, node.to),
    preview: resolveLocalMediaPreviewFromState(state, parsed.src),
  };
}

function collectImageNodeInfosInRanges(
  state: EditorState,
  dirtyRanges: readonly DirtyRange[],
): ImageNodeInfo[] {
  if (dirtyRanges.length === 0) return [];
  const infos: ImageNodeInfo[] = [];
  const seen = new Set<string>();

  for (const range of dirtyRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== "Image") return;
        if (!rangeIntersectsDirtyRanges(node.from, node.to, [range])) return;
        const key = `${node.from}:${node.to}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const info = buildImageNodeInfo(state, node.node);
        if (info) infos.push(info);
        return false;
      },
    });
  }

  return infos;
}

function collectAllImageNodeInfos(state: EditorState): ImageNodeInfo[] {
  return collectImageNodeInfosInRanges(state, [{ from: 0, to: state.doc.length }]);
}

function buildImageItemsFromInfos(
  state: EditorState,
  infos: readonly ImageNodeInfo[],
  activeSource: ActiveImageSourceTarget | null,
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  for (const info of infos) {
    const widget = info.preview
      ? mediaPreviewWidget(info.alt, info.src, info.preview, info.isBlock)
      : new ImagePreviewWidget(
          info.alt,
          info.src,
          { kind: "image", src: info.src },
          info.isBlock,
        );
    const activeBlockSource = info.isBlock
      && activeSourceTargetsEqual(activeSource, info);
    if (activeBlockSource) {
      widget.updateSourceRange(info.from, info.to);
      items.push(
        Decoration.widget({ widget, block: true, side: -1 }).range(info.from),
      );
      addActiveImageSourceDecorations(state, info, items);
    } else if (info.isBlock) {
      pushBlockWidgetDecoration(items, widget, info.from, info.to);
    } else {
      pushWidgetDecoration(items, widget, info.from, info.to);
    }
  }
  return items;
}

function buildDependencyCountsFromInfos(
  infos: readonly ImageNodeInfo[],
): LocalMediaDependencyCounts {
  const counts = createDependencyCounts();
  for (const info of infos) {
    applyDependencyDelta(counts, getImageDependency(info), 1);
  }
  return counts;
}

function buildImageDecorationState(state: EditorState): ImageDecorationState {
  const infos = measureSync(
    "cm6.imageDiscovery.collectAll",
    () => collectAllImageNodeInfos(state),
  );
  const dependencyCounts = buildDependencyCountsFromInfos(infos);
  const activeSource = getActiveImageSourceTarget(state);
  return {
    decorations: buildDecorations(buildImageItemsFromInfos(state, infos, activeSource)),
    mediaDependencies: dependencyCountsToDependencies(dependencyCounts),
    dependencyCounts,
    infosByResolvedPath: buildImageInfoPathIndex(infos),
    activeSource,
  };
}

function mapInfoRangeToDirtyRange(
  info: ImageNodeInfo,
  state: EditorState,
  changes: ChangeSet,
): DirtyRange {
  const mappedFrom = changes.mapPos(info.from, 1);
  const mappedTo = changes.mapPos(info.to, -1);
  return expandChangeRangeToLines(
    state.doc,
    Math.max(0, Math.min(mappedFrom, state.doc.length)),
    Math.max(0, Math.min(Math.max(mappedFrom, mappedTo), state.doc.length)),
  );
}

function imageDecorationTouchesDirtyRanges(
  from: number,
  to: number,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  if (from !== to) return rangeIntersectsDirtyRanges(from, to, dirtyRanges);
  for (const range of dirtyRanges) {
    if (from >= range.from && from <= range.to) return true;
    if (range.from > from) break;
  }
  return false;
}

function replaceImageDecorationsInRanges(
  state: EditorState,
  decorations: DecorationSet,
  dirtyRanges: readonly DirtyRange[],
  infos: readonly ImageNodeInfo[],
  activeSource: ActiveImageSourceTarget | null,
): DecorationSet {
  let next = decorations;
  for (const range of dirtyRanges) {
    next = next.update({
      filterFrom: range.from,
      filterTo: range.to,
      filter: (from, to) => !imageDecorationTouchesDirtyRanges(from, to, [range]),
    });
  }

  const items = buildImageItemsFromInfos(state, infos, activeSource);
  if (items.length > 0) {
    next = next.update({
      add: items,
      sort: true,
    });
  }
  return next;
}

const imageDecorationsChanged = createChangeChecker(
  { tree: true },
  (state) => state.field(pdfPreviewField, false),
  (state) => state.field(imageUrlField, false),
);

const imageDecorationField: StateField<ImageDecorationState> = StateField.define({
  create(state) {
    return measureSync(
      "cm6.imageDecorations.create",
      () => buildImageDecorationState(state),
    );
  },
  update(value, tr) {
    const beforeActiveSource = value.activeSource;
    const afterActiveSource = getActiveImageSourceTarget(tr.state);
    const mappedBeforeActiveSource = tr.docChanged
      ? mapActiveSourceTargetThroughChanges(
          beforeActiveSource,
          tr.state,
          tr.changes,
        )
      : beforeActiveSource;
    const activeSourceChanged = !activeSourceTargetsEqual(
      mappedBeforeActiveSource,
      afterActiveSource,
    );

    if (activeSourceChanged) {
      return buildImageDecorationState(tr.state);
    }

    if (tr.docChanged) {
      const oldDirtyRanges = dirtyRangesFromChanges(
        tr.changes,
        (from, to) => expandChangeRangeToLines(tr.startState.doc, from, to),
      );
      const newDirtyRanges = dirtyRangesFromChanges(
        tr.changes,
        (from, to) => expandChangeRangeToLines(tr.state.doc, from, to),
      );
      const oldInfos = collectImageNodeInfosInRanges(tr.startState, oldDirtyRanges);
      const newInfos = collectImageNodeInfosInRanges(tr.state, newDirtyRanges);
      const removedInfoKeys = new Set(oldInfos.map(imageInfoKey));
      const infosByResolvedPath = mapImageInfoPathIndexThroughChanges(
        value.infosByResolvedPath,
        tr.state,
        tr.changes,
        removedInfoKeys,
      );
      const dirtyRanges = [
        ...newDirtyRanges,
        ...oldInfos.map((info) => mapInfoRangeToDirtyRange(info, tr.state, tr.changes)),
      ];
      const dependencyCounts = cloneDependencyCounts(value.dependencyCounts);
      for (const info of oldInfos) {
        applyDependencyDelta(dependencyCounts, getImageDependency(info), -1);
      }
      for (const info of newInfos) {
        applyDependencyDelta(dependencyCounts, getImageDependency(info), 1);
        addImageInfoToPathIndex(infosByResolvedPath, info);
      }
      return {
        decorations: replaceImageDecorationsInRanges(
          tr.state,
          value.decorations.map(tr.changes),
          dirtyRanges,
          newInfos,
          afterActiveSource,
        ),
        mediaDependencies: dependencyCountsToDependencies(dependencyCounts),
        dependencyCounts,
        infosByResolvedPath,
        activeSource: afterActiveSource,
      };
    }

    const changedPaths = collectChangedLocalMediaPaths(
      value.mediaDependencies,
      tr.startState.field(pdfPreviewField, false) || new Map<string, unknown>(),
      tr.state.field(pdfPreviewField, false) || new Map<string, unknown>(),
      tr.startState.field(imageUrlField, false) || new Map<string, unknown>(),
      tr.state.field(imageUrlField, false) || new Map<string, unknown>(),
    );
    if (changedPaths.size > 0) {
      const infos = collectImageNodeInfosForResolvedPathsFromIndex(
        value.infosByResolvedPath,
        changedPaths,
      ).map((info) => refreshImageNodeInfoPreview(tr.state, info));
      return {
        decorations: replaceImageDecorationsInRanges(
          tr.state,
          value.decorations,
          infos.map((info) => ({ from: info.from, to: info.to })),
          infos,
          afterActiveSource,
        ),
        mediaDependencies: value.mediaDependencies,
        dependencyCounts: value.dependencyCounts,
        infosByResolvedPath: value.infosByResolvedPath,
        activeSource: afterActiveSource,
      };
    }

    return imageDecorationsChanged(tr) ? buildImageDecorationState(tr.state) : value;
  },
  provide: (field: StateField<ImageDecorationState>) => EditorView.decorations.from(
    field,
    (value: ImageDecorationState) => value.decorations,
  ),
});

function requestImagePreviewsForInfos(
  view: EditorView,
  infos: readonly ImageNodeInfo[],
  requestedSrcs?: Set<string>,
): void {
  for (const info of infos) {
    if (requestedSrcs?.has(info.src)) continue;
    requestedSrcs?.add(info.src);
    resolveLocalMediaPreview(view, info.src);
  }
}

function expandPreviewRange(
  state: EditorState,
  from: number,
  to: number,
): DirtyRange {
  return {
    from: Math.max(0, from - IMAGE_PREVIEW_PREFETCH_MARGIN),
    to: Math.min(state.doc.length, to + IMAGE_PREVIEW_PREFETCH_MARGIN),
  };
}

function previewRequestRangesForView(view: EditorView): readonly DirtyRange[] {
  const visibleRanges = view.visibleRanges.length > 0
    ? view.visibleRanges
    : [{ from: 0, to: Math.min(view.state.doc.length, INITIAL_IMAGE_PREVIEW_SCAN_LIMIT) }];

  if (
    visibleRanges.length === 1
    && visibleRanges[0].from === 0
    && visibleRanges[0].to === view.state.doc.length
    && view.state.doc.length > INITIAL_IMAGE_PREVIEW_SCAN_LIMIT
  ) {
    return [{ from: 0, to: INITIAL_IMAGE_PREVIEW_SCAN_LIMIT }];
  }

  return visibleRanges.map((range) =>
    expandPreviewRange(view.state, range.from, range.to)
  );
}

const imageRequestPlugin = ViewPlugin.fromClass(class {
  private readonly requestedSrcs = new Set<string>();

  constructor(view: EditorView) {
    this.requestNearViewport(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      const dirtyRanges = dirtyRangesFromChanges(
        update.changes,
        (from, to) => expandChangeRangeToLines(update.state.doc, from, to),
      );
      requestImagePreviewsForInfos(
        update.view,
        collectImageNodeInfosInRanges(update.state, dirtyRanges),
        this.requestedSrcs,
      );
      return;
    }

    if (update.viewportChanged) {
      this.requestNearViewport(update.view);
    }

    if (syntaxTree(update.state) !== syntaxTree(update.startState)) {
      this.requestNearViewport(update.view);
    }
  }

  destroy(): void {
    this.requestedSrcs.clear();
  }

  private requestNearViewport(view: EditorView): void {
    const infos = measureSync(
      "cm6.imageDiscovery.collectViewport",
      () => collectImageNodeInfosInRanges(view.state, previewRequestRangesForView(view)),
    );
    requestImagePreviewsForInfos(view, infos, this.requestedSrcs);
  }
});

export { imageDecorationField as _imageDecorationFieldForTest };

export const imageRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  imageDecorationField,
  imageRequestPlugin,
];
