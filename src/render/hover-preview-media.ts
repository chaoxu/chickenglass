import type { EditorView } from "@codemirror/view";
import { CSS } from "../constants";
import { collectImageTargets } from "../lib/markdown/image-targets";
import { createPreviewSurfaceBody } from "../preview-surface";
import {
  createLocalMediaDependencies,
  getLocalMediaPreviewDependency,
  getLocalMediaPreviewDependencyKey,
  resolveLocalMediaPreview,
  trackLocalMediaPreviewDependency,
  type LocalMediaDependencies,
} from "./media-preview";
import { getPdfCanvas } from "./pdf-preview-cache";

const HOVER_PREVIEW_TABLE_SCROLL_CLASS = "cf-hover-preview-table-scroll";
const HOVER_PREVIEW_CODE_BLOCK_CLASS = "cf-hover-preview-code-block";

interface PdfCanvasReplacement {
  readonly resolvedPath: string;
  readonly src: string;
}

export interface BlockPreviewMediaState {
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly key: string;
  readonly loadingLocalMedia: readonly string[];
  readonly mediaDependencies: LocalMediaDependencies;
  readonly readyPdfPreviews: readonly PdfCanvasReplacement[];
  readonly unavailableLocalMedia: readonly string[];
}

export function buildBlockPreviewMediaState(
  view: EditorView,
  text: string,
): BlockPreviewMediaState {
  const imageUrlOverrides = new Map<string, string>();
  const mediaDependencies = createLocalMediaDependencies();
  const readyPdfPreviews: PdfCanvasReplacement[] = [];
  const loadingLocalMedia: string[] = [];
  const unavailableLocalMedia: string[] = [];
  const keyParts: string[] = [];

  for (const src of collectImageTargets(text)) {
    const preview = resolveLocalMediaPreview(view, src);
    if (!preview) continue;
    const dependency = getLocalMediaPreviewDependency(src, preview);
    trackLocalMediaPreviewDependency(mediaDependencies, dependency);
    keyParts.push(getLocalMediaPreviewDependencyKey(dependency));

    if (preview.kind === "image") {
      imageUrlOverrides.set(preview.resolvedPath, preview.dataUrl);
      continue;
    }

    if (preview.kind === "pdf-canvas") {
      readyPdfPreviews.push({
        resolvedPath: preview.resolvedPath,
        src,
      });
      continue;
    }

    if (preview.kind === "loading") {
      loadingLocalMedia.push(src);
      continue;
    }

    unavailableLocalMedia.push(src);
  }

  return {
    imageUrlOverrides: imageUrlOverrides.size > 0 ? imageUrlOverrides : undefined,
    key: keyParts.join("\0"),
    loadingLocalMedia,
    mediaDependencies,
    readyPdfPreviews,
    unavailableLocalMedia,
  };
}

export function appendMediaFallback(
  body: HTMLElement,
  loadingLocalMedia: readonly string[],
  unavailableLocalMedia: readonly string[],
): void {
  if (loadingLocalMedia.length === 0 && unavailableLocalMedia.length === 0) return;

  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (src && (loadingLocalMedia.includes(src) || unavailableLocalMedia.includes(src))) {
      img.remove();
    }
  }

  if (loadingLocalMedia.length > 0) {
    const loading = createPreviewSurfaceBody(CSS.hoverPreviewUnresolved);
    loading.textContent = `Loading preview: ${loadingLocalMedia
      .map((src) => src.split("/").pop() ?? src)
      .join(", ")}`;
    body.appendChild(loading);
  }

  if (unavailableLocalMedia.length > 0) {
    const fallback = createPreviewSurfaceBody(CSS.hoverPreviewUnresolved);
    fallback.textContent = `Preview unavailable: ${unavailableLocalMedia
      .map((src) => src.split("/").pop() ?? src)
      .join(", ")}`;
    body.appendChild(fallback);
  }
}

export function normalizeWidePreviewContent(body: HTMLElement): void {
  for (const table of body.querySelectorAll("table")) {
    const parent = table.parentElement;
    if (!parent || parent.classList.contains(HOVER_PREVIEW_TABLE_SCROLL_CLASS)) continue;

    const scroll = document.createElement("div");
    scroll.className = HOVER_PREVIEW_TABLE_SCROLL_CLASS;
    parent.insertBefore(scroll, table);
    scroll.appendChild(table);
  }

  for (const pre of body.querySelectorAll("pre")) {
    pre.classList.add(HOVER_PREVIEW_CODE_BLOCK_CLASS);
  }
}

export function normalizeWidePreviewContentForTest(body: HTMLElement): void {
  normalizeWidePreviewContent(body);
}

function clonePdfCanvasForHoverPreview(
  source: HTMLCanvasElement,
  alt: string,
): HTMLCanvasElement {
  const clone = document.createElement("canvas");
  clone.width = source.width;
  clone.height = source.height;
  clone.style.display = "block";
  clone.style.marginInline = "auto";
  clone.style.maxWidth = "100%";
  clone.style.height = "auto";
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-label", alt || "PDF preview");

  // The tooltip owns this clone. When the singleton tooltip replaces or
  // clears its children, the cloned canvas becomes unreachable as well.
  const ctx = clone.getContext("2d");
  if (ctx) {
    ctx.drawImage(source, 0, 0);
  }

  return clone;
}

export function replacePdfPreviewImages(
  body: HTMLElement,
  readyPdfPreviews: readonly PdfCanvasReplacement[],
): void {
  if (readyPdfPreviews.length === 0) return;

  const replacementBySrc = new Map(
    readyPdfPreviews.map((preview) => [preview.src, preview.resolvedPath] as const),
  );

  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src) continue;

    const resolvedPath = replacementBySrc.get(src);
    if (!resolvedPath) continue;

    const sourceCanvas = getPdfCanvas(resolvedPath);
    if (!sourceCanvas) continue;

    img.replaceWith(
      clonePdfCanvasForHoverPreview(sourceCanvas, img.getAttribute("alt") ?? ""),
    );
  }
}
