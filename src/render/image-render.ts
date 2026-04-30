import {
  type ChangeSet,
  type EditorState,
  type Extension,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  pushBlockWidgetDecoration,
  pushWidgetDecoration,
} from "./decoration-core";
import { imageUrlField } from "../state/image-url";
import {
  collectChangedLocalMediaPathsFromIndex,
  localMediaReferenceRangesForResolvedPaths,
  mediaIndexField,
} from "../state/media-index";
import { pdfPreviewField } from "../state/pdf-preview";
import { resolveLocalMediaPreview } from "./media-preview";
import { requestScrollStabilizedMeasure } from "./scroll-anchor";
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
  mapActiveSourceTargetThroughChanges,
} from "./image-source-reveal";
import {
  collectAllImageNodeInfos,
  collectImageNodeInfosInRanges,
  refreshImageNodeInfoPreview,
  type ImageNodeInfo,
} from "./image-node-info";
import {
  ImagePreviewWidget,
  mediaPreviewWidget,
} from "./image-preview-widget";
import { measureSync } from "../lib/perf";

const INITIAL_IMAGE_PREVIEW_SCAN_LIMIT = 20_000;
const IMAGE_PREVIEW_PREFETCH_MARGIN = 4_000;

interface ImageDecorationState {
  readonly decorations: DecorationSet;
  readonly activeSource: ActiveImageSourceTarget | null;
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

function buildImageDecorationState(state: EditorState): ImageDecorationState {
  const infos = measureSync(
    "cm6.imageDiscovery.collectAll",
    () => collectAllImageNodeInfos(state),
  );
  const activeSource = getActiveImageSourceTarget(state);
  return {
    decorations: buildDecorations(buildImageItemsFromInfos(state, infos, activeSource)),
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
      const dirtyRanges = [
        ...newDirtyRanges,
        ...oldInfos.map((info) => mapInfoRangeToDirtyRange(info, tr.state, tr.changes)),
      ];
      return {
        decorations: replaceImageDecorationsInRanges(
          tr.state,
          value.decorations.map(tr.changes),
          dirtyRanges,
          newInfos,
          afterActiveSource,
        ),
        activeSource: afterActiveSource,
      };
    }

    const oldPdfCache = tr.startState.field(pdfPreviewField, false) || new Map<string, unknown>();
    const newPdfCache = tr.state.field(pdfPreviewField, false) || new Map<string, unknown>();
    const oldImageCache = tr.startState.field(imageUrlField, false) || new Map<string, unknown>();
    const newImageCache = tr.state.field(imageUrlField, false) || new Map<string, unknown>();
    const mediaCacheChanged = oldPdfCache !== newPdfCache || oldImageCache !== newImageCache;
    if (mediaCacheChanged) {
      const mediaIndex = tr.state.field(mediaIndexField, false);
      if (!mediaIndex) return buildImageDecorationState(tr.state);
      const changedPaths = collectChangedLocalMediaPathsFromIndex(
        mediaIndex,
        oldPdfCache,
        newPdfCache,
        oldImageCache,
        newImageCache,
      );
      if (changedPaths.size === 0) return value;
      const refreshRanges = localMediaReferenceRangesForResolvedPaths(
        mediaIndex,
        changedPaths,
      );
      const infos = collectImageNodeInfosInRanges(
        tr.state,
        refreshRanges,
      ).map((info) => refreshImageNodeInfoPreview(tr.state, info));
      return {
        decorations: replaceImageDecorationsInRanges(
          tr.state,
          value.decorations,
          infos.map((info) => ({ from: info.from, to: info.to })),
          infos,
          afterActiveSource,
        ),
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
    if (localMediaCacheChangedForTrackedImage(update)) {
      requestScrollStabilizedMeasure(update.view);
    }

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

function localMediaCacheChangedForTrackedImage(update: ViewUpdate): boolean {
  const oldPdfCache = update.startState.field(pdfPreviewField, false) || new Map<string, unknown>();
  const newPdfCache = update.state.field(pdfPreviewField, false) || new Map<string, unknown>();
  const oldImageCache = update.startState.field(imageUrlField, false) || new Map<string, unknown>();
  const newImageCache = update.state.field(imageUrlField, false) || new Map<string, unknown>();
  if (oldPdfCache === newPdfCache && oldImageCache === newImageCache) return false;

  const mediaIndex = update.state.field(mediaIndexField, false);
  if (!mediaIndex) return false;
  return collectChangedLocalMediaPathsFromIndex(
    mediaIndex,
    oldPdfCache,
    newPdfCache,
    oldImageCache,
    newImageCache,
  ).size > 0;
}

export { imageDecorationField as _imageDecorationFieldForTest };
export { ImagePreviewWidget } from "./image-preview-widget";

export const imageRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mediaIndexField,
  imageDecorationField,
  imageRequestPlugin,
];
