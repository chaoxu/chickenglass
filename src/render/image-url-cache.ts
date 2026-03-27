/**
 * Non-PDF image URL cache for rich-mode rendering.
 *
 * Relative image paths are resolved to project-relative file paths and then
 * loaded through the FileSystem abstraction. The resulting Blob URLs live in
 * a module-level cache while CM6 state tracks only load status.
 */
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FileSystem } from "../lib/types";

export type ImageUrlStatus = "loading" | "ready" | "error";

export interface ImageUrlEntry {
  readonly status: ImageUrlStatus;
  readonly errorTime?: number;
}

export interface ImageUrlUpdate {
  readonly path: string;
  readonly entry: ImageUrlEntry;
}

export const imageUrlEffect = StateEffect.define<ImageUrlUpdate>();
export const imageUrlRemoveEffect = StateEffect.define<string>();
export const imageUrlResetEffect = StateEffect.define<null>();

export const IMAGE_ERROR_COOLDOWN_MS = 10_000;

export const imageUrlField = StateField.define<
  ReadonlyMap<string, ImageUrlEntry>
>({
  create() {
    return new Map();
  },
  update(value, tr) {
    let updated: Map<string, ImageUrlEntry> | null = null;
    for (const effect of tr.effects) {
      if (effect.is(imageUrlEffect)) {
        if (!updated) updated = new Map(value);
        updated.set(effect.value.path, effect.value.entry);
      } else if (effect.is(imageUrlRemoveEffect)) {
        if (value.has(effect.value)) {
          if (!updated) updated = new Map(value);
          updated.delete(effect.value);
        }
      } else if (effect.is(imageUrlResetEffect)) {
        if (!updated) updated = new Map(value);
        updated.clear();
      }
    }
    return updated ?? value;
  },
});

const MAX_IMAGE_URL_CACHE_SIZE = 64;
const imageUrlCache = new Map<string, string>();
const pendingPaths = new Set<string>();
const imagePathVersions = new Map<string, number>();
let imageCacheGeneration = 0;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

function getImageMimeType(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0];
  const dot = cleanPath.lastIndexOf(".");
  const ext = dot >= 0 ? cleanPath.slice(dot + 1).toLowerCase() : "";
  return IMAGE_MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function getImageUrl(path: string): string | undefined {
  return imageUrlCache.get(path);
}

export function clearImageUrl(path: string): void {
  const url = imageUrlCache.get(path);
  if (!url) return;
  imageUrlCache.delete(path);
  URL.revokeObjectURL(url);
}

export function resetImageUrlCache(): void {
  imageCacheGeneration += 1;
  pendingPaths.clear();
  imagePathVersions.clear();
  for (const path of [...imageUrlCache.keys()]) {
    clearImageUrl(path);
  }
}

export function invalidateImagePath(view: EditorView | null, path: string): void {
  imagePathVersions.set(path, (imagePathVersions.get(path) ?? 0) + 1);
  pendingPaths.delete(path);
  clearImageUrl(path);
  if (!view) return;
  safeRemove(view, path);
}

export function resetImageUrlState(view: EditorView | null): void {
  resetImageUrlCache();
  if (!view) return;
  safeReset(view);
}

/** Exported for testing only — clears all module-level caches. */
export function _resetImageUrlCache(): void {
  resetImageUrlCache();
}

export async function requestImageUrl(
  view: EditorView,
  path: string,
  fs: FileSystem,
): Promise<void> {
  const existing = view.state.field(imageUrlField).get(path);

  if (existing) {
    if (existing.status === "ready" && imageUrlCache.has(path)) return;

    if (existing.status === "error") {
      const elapsed = Date.now() - (existing.errorTime ?? 0);
      if (elapsed < IMAGE_ERROR_COOLDOWN_MS) return;
    }

    if (existing.status === "loading") return;
  }

  if (pendingPaths.has(path)) return;
  pendingPaths.add(path);
  const requestGeneration = imageCacheGeneration;
  const requestPathVersion = imagePathVersions.get(path) ?? 0;

  // Image requests are triggered from a render plugin's decoration build.
  // Defer to the next task so we never re-enter CM6 during an update and the
  // view is connected before we dispatch the cache state change.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

  if (isStaleRequest(path, requestGeneration, requestPathVersion)) {
    pendingPaths.delete(path);
    return;
  }

  if (!safeDispatch(view, { path, entry: { status: "loading" } })) {
    pendingPaths.delete(path);
    return;
  }

  try {
    const bytes = await fs.readFileBinary(path);
    const blobBytes = new Uint8Array(bytes);
    const blob = new Blob([blobBytes], { type: getImageMimeType(path) });
    const objectUrl = URL.createObjectURL(blob);

    if (!view.dom.isConnected || isStaleRequest(path, requestGeneration, requestPathVersion)) {
      URL.revokeObjectURL(objectUrl);
      return;
    }

    if (imageUrlCache.size >= MAX_IMAGE_URL_CACHE_SIZE) {
      const oldest = imageUrlCache.keys().next().value;
      if (oldest !== undefined) {
        clearImageUrl(oldest);
        safeRemove(view, oldest);
      }
    }

    clearImageUrl(path);
    imageUrlCache.set(path, objectUrl);

    if (!safeDispatch(view, { path, entry: { status: "ready" } })) {
      clearImageUrl(path);
      return;
    }
  } catch {
    if (!isStaleRequest(path, requestGeneration, requestPathVersion)) {
      safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
    }
  } finally {
    pendingPaths.delete(path);
  }
}

function isStaleRequest(
  path: string,
  requestGeneration: number,
  requestPathVersion: number,
): boolean {
  return (
    imageCacheGeneration !== requestGeneration ||
    (imagePathVersions.get(path) ?? 0) !== requestPathVersion
  );
}

function safeDispatch(view: EditorView, update: ImageUrlUpdate): boolean {
  if (!view.dom.isConnected) return false;
  try {
    view.dispatch({ effects: imageUrlEffect.of(update) });
    return true;
  } catch {
    return false;
  }
}

function safeRemove(view: EditorView, path: string): boolean {
  if (!view.dom.isConnected) return false;
  try {
    view.dispatch({ effects: imageUrlRemoveEffect.of(path) });
    return true;
  } catch {
    return false;
  }
}

function safeReset(view: EditorView): boolean {
  if (!view.dom.isConnected) return false;
  try {
    view.dispatch({ effects: imageUrlResetEffect.of(null) });
    return true;
  } catch {
    return false;
  }
}
