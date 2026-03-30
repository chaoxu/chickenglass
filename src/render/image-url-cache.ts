import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { readImageFileAsDataUrl } from "../lib/image-data-url";
import type { FileSystem } from "../lib/types";
import { ERROR_COOLDOWN_MS, type MediaEntryBase } from "./pdf-preview-cache";

export type ImageUrlStatus = "loading" | "ready" | "error";

export interface ImageUrlEntry extends MediaEntryBase {
  readonly status: ImageUrlStatus;
}

export interface ImageUrlUpdate {
  readonly path: string;
  readonly entry: ImageUrlEntry;
}

export const imageUrlEffect = StateEffect.define<ImageUrlUpdate>();

export const imageUrlField = StateField.define<
  ReadonlyMap<string, ImageUrlEntry>
>({
  create() {
    return new Map();
  },
  update(value, tr) {
    let updated: Map<string, ImageUrlEntry> | null = null;
    for (const effect of tr.effects) {
      if (!effect.is(imageUrlEffect)) continue;
      if (!updated) updated = new Map(value);
      updated.set(effect.value.path, effect.value.entry);
    }
    return updated ?? value;
  },
});

const dataUrlCache = new Map<string, string>();
const pendingPaths = new Set<string>();

export function getImageDataUrl(path: string): string | undefined {
  return dataUrlCache.get(path);
}

export function _resetImageUrlCache(): void {
  pendingPaths.clear();
  dataUrlCache.clear();
}

export async function requestImageDataUrl(
  view: EditorView,
  path: string,
  fs: FileSystem,
): Promise<void> {
  const existing = view.state.field(imageUrlField).get(path);

  if (existing) {
    // Ready with cached data URL — nothing to do
    if (existing.status === "ready" && dataUrlCache.has(path)) return;

    // Error entries can be retried after cooldown
    if (existing.status === "error") {
      const elapsed = Date.now() - (existing.errorTime ?? 0);
      if (elapsed < ERROR_COOLDOWN_MS) return;
      // Cooldown expired — fall through to retry
    }

    // Loading — already in progress
    if (existing.status === "loading") return;
  }

  if (pendingPaths.has(path)) return;
  pendingPaths.add(path);

  safeDispatch(view, { path, entry: { status: "loading" } });

  try {
    const dataUrl = await readImageFileAsDataUrl(path, fs);
    if (!dataUrl) {
      safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
      return;
    }

    dataUrlCache.set(path, dataUrl);
    safeDispatch(view, { path, entry: { status: "ready" } });
  } catch {
    safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
  } finally {
    pendingPaths.delete(path);
  }
}

function safeDispatch(view: EditorView, update: ImageUrlUpdate): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: imageUrlEffect.of(update) });
  } catch {
    // View disconnected between guard and dispatch.
  }
}
