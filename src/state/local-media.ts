import type { EditorState } from "@codemirror/state";
import { resolveMarkdownReferencePathFromDocument } from "../lib/markdown-reference-paths";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";
import { documentPathFacet } from "../lib/types";

export type LocalMediaCacheKind = "image" | "pdf";

export interface LocalMediaPreviewDependency {
  readonly cacheKind: LocalMediaCacheKind;
  readonly resolvedPath: string;
  readonly status: "ready" | "loading" | "error";
}

export interface LocalMediaDependencies {
  readonly imagePaths: ReadonlySet<string>;
  readonly pdfPaths: ReadonlySet<string>;
}

const EMPTY_LOCAL_MEDIA_PATHS = new Set<string>();
const EMPTY_CHANGED_MEDIA_PATHS: ReadonlySet<string> = new Set<string>();

export const EMPTY_LOCAL_MEDIA_DEPENDENCIES: LocalMediaDependencies = {
  imagePaths: EMPTY_LOCAL_MEDIA_PATHS,
  pdfPaths: EMPTY_LOCAL_MEDIA_PATHS,
};

type MediaCache = ReadonlyMap<string, unknown>;

export function classifyLocalMediaTarget(src: string): LocalMediaCacheKind | null {
  if (isPdfTarget(src)) return "pdf";
  return isRelativeFilePath(src) ? "image" : null;
}

export function resolveLocalMediaPathFromState(
  state: EditorState,
  src: string,
): string | null {
  if (!classifyLocalMediaTarget(src)) return null;
  const docPath = state.facet(documentPathFacet);
  return resolveMarkdownReferencePathFromDocument(docPath, src);
}

export function createLocalMediaDependencies(): {
  imagePaths: Set<string>;
  pdfPaths: Set<string>;
} {
  return {
    imagePaths: new Set<string>(),
    pdfPaths: new Set<string>(),
  };
}

export function trackLocalMediaPreviewDependency(
  dependencies: {
    imagePaths: Set<string>;
    pdfPaths: Set<string>;
  },
  dependency: LocalMediaPreviewDependency,
): void {
  const paths = dependency.cacheKind === "pdf"
    ? dependencies.pdfPaths
    : dependencies.imagePaths;
  paths.add(dependency.resolvedPath);
}

export function localMediaDependenciesChanged(
  dependencies: LocalMediaDependencies,
  oldPdfCache: MediaCache,
  newPdfCache: MediaCache,
  oldImgCache: MediaCache,
  newImgCache: MediaCache,
): boolean {
  return (
    cacheEntriesChanged(dependencies.pdfPaths, oldPdfCache, newPdfCache) ||
    cacheEntriesChanged(dependencies.imagePaths, oldImgCache, newImgCache)
  );
}

export function collectChangedLocalMediaPaths(
  dependencies: LocalMediaDependencies,
  oldPdfCache: MediaCache,
  newPdfCache: MediaCache,
  oldImgCache: MediaCache,
  newImgCache: MediaCache,
): ReadonlySet<string> {
  if (
    !localMediaDependenciesChanged(
      dependencies,
      oldPdfCache,
      newPdfCache,
      oldImgCache,
      newImgCache,
    )
  ) {
    return EMPTY_CHANGED_MEDIA_PATHS;
  }

  const changedPaths = new Set<string>();
  collectChangedPaths(dependencies.pdfPaths, oldPdfCache, newPdfCache, changedPaths);
  collectChangedPaths(dependencies.imagePaths, oldImgCache, newImgCache, changedPaths);
  return changedPaths;
}

function cacheEntriesChanged(
  paths: ReadonlySet<string>,
  oldCache: MediaCache,
  newCache: MediaCache,
): boolean {
  if (paths.size === 0 || oldCache === newCache) return false;

  for (const path of paths) {
    if (oldCache.get(path) !== newCache.get(path)) {
      return true;
    }
  }

  return false;
}

function collectChangedPaths(
  paths: ReadonlySet<string>,
  oldCache: MediaCache,
  newCache: MediaCache,
  changedPaths: Set<string>,
): void {
  if (paths.size === 0 || oldCache === newCache) return;

  for (const path of paths) {
    if (oldCache.get(path) !== newCache.get(path)) {
      changedPaths.add(path);
    }
  }
}
