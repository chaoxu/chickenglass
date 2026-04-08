/**
 * Unified local media preview resolution.
 *
 * Resolves a relative image or PDF target against the current document,
 * checks the appropriate CM6 cache, and fires async load requests when
 * needed.  Returns a discriminated result describing the current preview
 * state — the renderer maps this to the correct widget.
 */
import type { EditorView } from "@codemirror/view";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import { documentPathFacet, fileSystemFacet, type FileSystem } from "../lib/types";
import {
  getImageDataUrl,
  imageUrlField,
  requestImageDataUrl,
} from "./image-url-cache";
import {
  getPdfCanvas,
  pdfPreviewField,
  requestPdfPreview,
} from "./pdf-preview-cache";

// ── Result type ─────────────────────────────────────────────────────────────

export type MediaPreviewResult =
  | { readonly kind: "image"; readonly resolvedPath: string; readonly dataUrl: string }
  | { readonly kind: "pdf-canvas"; readonly resolvedPath: string }
  | { readonly kind: "loading"; readonly resolvedPath: string; readonly isPdf: boolean }
  | { readonly kind: "error"; readonly resolvedPath: string; readonly fallbackSrc: string };

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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve a local media reference (image or PDF) to a preview result.
 *
 * Returns `null` for non-local sources (absolute URLs, data URIs, etc.)
 * — callers render those directly with the raw src.
 */
export function resolveLocalMediaPath(
  view: EditorView,
  src: string,
): string | null {
  if (!isPdfTarget(src) && !isRelativeFilePath(src)) return null;
  const docPath = view.state.facet(documentPathFacet);
  return resolveProjectPathFromDocument(docPath, src);
}

export function resolveLocalMediaPreview(
  view: EditorView,
  src: string,
): MediaPreviewResult | null {
  const resolvedPath = resolveLocalMediaPath(view, src);
  if (!resolvedPath) return null;
  if (isPdfTarget(src)) return resolvePdfPreview(view, src, resolvedPath);
  return resolveImagePreview(view, src, resolvedPath);
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

export function getLocalMediaPreviewDependency(
  src: string,
  preview: MediaPreviewResult,
): LocalMediaPreviewDependency {
  switch (preview.kind) {
    case "image":
      return {
        cacheKind: "image",
        resolvedPath: preview.resolvedPath,
        status: "ready",
      };
    case "pdf-canvas":
      return {
        cacheKind: "pdf",
        resolvedPath: preview.resolvedPath,
        status: "ready",
      };
    case "loading":
      return {
        cacheKind: preview.isPdf ? "pdf" : "image",
        resolvedPath: preview.resolvedPath,
        status: "loading",
      };
    case "error":
      return {
        cacheKind: isPdfTarget(src) ? "pdf" : "image",
        resolvedPath: preview.resolvedPath,
        status: "error",
      };
  }
}

export function getLocalMediaPreviewDependencyKey(
  dependency: LocalMediaPreviewDependency,
): string {
  return `${dependency.cacheKind}:${dependency.resolvedPath}:${dependency.status}`;
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

// ── Internal ────────────────────────────────────────────────────────────────

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

function resolvePdfPreview(
  view: EditorView,
  src: string,
  resolvedPath: string,
): MediaPreviewResult {
  const entry = view.state.field(pdfPreviewField).get(resolvedPath);

  // #473: "ready" with no canvas means the canvas was evicted from the
  // module-level cache — treat as a cache miss and re-request.
  if (entry?.status === "ready" && getPdfCanvas(resolvedPath) !== undefined) {
    return { kind: "pdf-canvas", resolvedPath };
  }

  if (entry?.status === "error") {
    // #472: re-request so the retry cooldown logic in requestPdfPreview
    // can decide whether to retry.
    fireRequest(view, resolvedPath, requestPdfPreview);
    return { kind: "error", resolvedPath, fallbackSrc: src };
  }

  if (!entry || entry.status !== "loading") {
    fireRequest(view, resolvedPath, requestPdfPreview);
  }
  return { kind: "loading", resolvedPath, isPdf: true };
}

function resolveImagePreview(
  view: EditorView,
  src: string,
  resolvedPath: string,
): MediaPreviewResult {
  const entry = view.state.field(imageUrlField).get(resolvedPath);
  const dataUrl =
    entry?.status === "ready" ? getImageDataUrl(resolvedPath) : undefined;

  if (dataUrl) {
    return { kind: "image", resolvedPath, dataUrl };
  }

  if (entry?.status === "error") {
    // Re-request so the retry cooldown logic in requestImageDataUrl
    // can decide whether to retry.
    fireRequest(view, resolvedPath, requestImageDataUrl);
    return { kind: "error", resolvedPath, fallbackSrc: src };
  }

  if (!entry || entry.status !== "loading") {
    fireRequest(view, resolvedPath, requestImageDataUrl);
  }
  return { kind: "loading", resolvedPath, isPdf: false };
}

type RequestFn = (
  view: EditorView,
  path: string,
  fs: FileSystem,
) => Promise<void>;

function fireRequest(
  view: EditorView,
  resolvedPath: string,
  request: RequestFn,
): void {
  const fs = view.state.facet(fileSystemFacet);
  if (fs) void request(view, resolvedPath, fs);
}
