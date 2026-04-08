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

// ── Internal ────────────────────────────────────────────────────────────────

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
