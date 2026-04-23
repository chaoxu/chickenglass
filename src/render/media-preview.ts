/**
 * Unified local media preview resolution.
 *
 * Resolves a relative image or PDF target against the current document,
 * checks the appropriate CM6 cache, and fires async load requests when
 * needed.  Returns a discriminated result describing the current preview
 * state — the renderer maps this to the correct widget.
 */
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { fileSystemFacet, type FileSystem } from "../lib/types";
import { imageUrlField, type ImageUrlEntry } from "../state/image-url";
import {
  classifyLocalMediaTarget,
  collectChangedLocalMediaPaths,
  createLocalMediaDependencies,
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  localMediaDependenciesChanged,
  resolveLocalMediaPathFromState,
  trackLocalMediaPreviewDependency,
  type LocalMediaCacheKind,
  type LocalMediaDependencies,
  type LocalMediaPreviewDependency,
} from "../state/local-media";
import { pdfPreviewField, type PdfPreviewEntry } from "../state/pdf-preview";
import {
  getImageDataUrl,
  requestImageDataUrl,
} from "./image-url-cache";
import {
  getPdfCanvas,
  requestPdfPreview,
} from "./pdf-preview-cache";

// ── Result type ─────────────────────────────────────────────────────────────

export type MediaPreviewResult =
  | { readonly kind: "image"; readonly resolvedPath: string; readonly dataUrl: string }
  | { readonly kind: "pdf-canvas"; readonly resolvedPath: string }
  | { readonly kind: "loading"; readonly resolvedPath: string; readonly isPdf: boolean }
  | { readonly kind: "error"; readonly resolvedPath: string; readonly fallbackSrc: string };

export {
  collectChangedLocalMediaPaths,
  createLocalMediaDependencies,
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  localMediaDependenciesChanged,
  resolveLocalMediaPathFromState,
  trackLocalMediaPreviewDependency,
  type LocalMediaCacheKind,
  type LocalMediaDependencies,
  type LocalMediaPreviewDependency,
};

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
  return resolveLocalMediaPathFromState(view.state, src);
}

export function resolveLocalMediaPreview(
  view: EditorView,
  src: string,
): MediaPreviewResult | null {
  const resolvedPath = resolveLocalMediaPathFromState(view.state, src);
  if (!resolvedPath) return null;
  if (classifyLocalMediaTarget(src) === "pdf") return resolvePdfPreview(view, src, resolvedPath);
  return resolveImagePreview(view, src, resolvedPath);
}

export function resolveLocalMediaPreviewFromState(
  state: EditorState,
  src: string,
): MediaPreviewResult | null {
  const resolvedPath = resolveLocalMediaPathFromState(state, src);
  if (!resolvedPath) return null;
  if (classifyLocalMediaTarget(src) === "pdf") return resolvePdfPreviewFromState(state, src, resolvedPath);
  return resolveImagePreviewFromState(state, src, resolvedPath);
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
        cacheKind: classifyLocalMediaTarget(src) === "pdf" ? "pdf" : "image",
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

// ── Internal ────────────────────────────────────────────────────────────────

function resolvePdfPreview(
  view: EditorView,
  src: string,
  resolvedPath: string,
): MediaPreviewResult {
  const entry = (view.state.field(pdfPreviewField, false) ?? new Map<string, PdfPreviewEntry>())
    .get(resolvedPath);
  const current = resolvePdfPreviewEntry(src, resolvedPath, entry);
  if (current) return current;

  fireRequest(view, resolvedPath, requestPdfPreview);
  return { kind: "loading", resolvedPath, isPdf: true };
}

function resolvePdfPreviewFromState(
  state: EditorState,
  src: string,
  resolvedPath: string,
): MediaPreviewResult {
  const entry = (state.field(pdfPreviewField, false) ?? new Map<string, PdfPreviewEntry>())
    .get(resolvedPath);
  return resolvePdfPreviewEntry(src, resolvedPath, entry)
    ?? { kind: "loading", resolvedPath, isPdf: true };
}

function resolvePdfPreviewEntry(
  src: string,
  resolvedPath: string,
  entry: PdfPreviewEntry | undefined,
): MediaPreviewResult | null {
  // #473: "ready" with no canvas means the canvas was evicted from the
  // module-level cache — treat as a cache miss and re-request.
  if (entry?.status === "ready" && getPdfCanvas(resolvedPath) !== undefined) {
    return { kind: "pdf-canvas", resolvedPath };
  }

  if (entry?.status === "error") {
    return { kind: "error", resolvedPath, fallbackSrc: src };
  }
  return null;
}

function resolveImagePreview(
  view: EditorView,
  src: string,
  resolvedPath: string,
): MediaPreviewResult {
  const entry = (view.state.field(imageUrlField, false) ?? new Map<string, ImageUrlEntry>())
    .get(resolvedPath);
  const current = resolveImagePreviewEntry(src, resolvedPath, entry);
  if (current) return current;

  fireRequest(view, resolvedPath, requestImageDataUrl);
  return { kind: "loading", resolvedPath, isPdf: false };
}

function resolveImagePreviewFromState(
  state: EditorState,
  src: string,
  resolvedPath: string,
): MediaPreviewResult {
  const entry = (state.field(imageUrlField, false) ?? new Map<string, ImageUrlEntry>())
    .get(resolvedPath);
  return resolveImagePreviewEntry(src, resolvedPath, entry)
    ?? { kind: "loading", resolvedPath, isPdf: false };
}

function resolveImagePreviewEntry(
  src: string,
  resolvedPath: string,
  entry: ImageUrlEntry | undefined,
): MediaPreviewResult | null {
  const dataUrl =
    entry?.status === "ready" ? getImageDataUrl(resolvedPath) : undefined;

  if (dataUrl) {
    return { kind: "image", resolvedPath, dataUrl };
  }

  if (entry?.status === "error") {
    return { kind: "error", resolvedPath, fallbackSrc: src };
  }
  return null;
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
