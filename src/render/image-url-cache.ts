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
export const imageUrlRemoveEffect = StateEffect.define<string>();

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
        const source = updated ?? value;
        if (!source.has(effect.value)) continue;
        if (!updated) updated = new Map(value);
        updated.delete(effect.value);
      }
    }
    return updated ?? value;
  },
});

const dataUrlCache = new Map<string, string>();
const pendingPaths = new Map<string, number>();
const pathGenerations = new Map<string, number>();

export function getImageDataUrl(path: string): string | undefined {
  return dataUrlCache.get(path);
}

export function _resetImageUrlCache(): void {
  dataUrlCache.clear();
  pendingPaths.clear();
  pathGenerations.clear();
}

export function invalidateImageDataUrl(view: EditorView, path: string): void {
  const hadCache = dataUrlCache.delete(path);
  const hadEntry = view.state.field(imageUrlField).has(path);
  const hadPending = pendingPaths.has(path);

  if (!hadCache && !hadEntry && !hadPending) {
    return;
  }

  pathGenerations.set(path, (pathGenerations.get(path) ?? 0) + 1);

  if (hadEntry) {
    safeRemove(view, path);
  }
}

export async function requestImageDataUrl(
  view: EditorView,
  path: string,
  fs: FileSystem,
): Promise<void> {
  const existing = view.state.field(imageUrlField).get(path);
  const generation = pathGenerations.get(path) ?? 0;

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

  if (pendingPaths.get(path) === generation) return;
  pendingPaths.set(path, generation);

  safeDispatch(view, { path, entry: { status: "loading" } });

  try {
    const dataUrl = await readImageFileAsDataUrl(path, fs);
    if (!isCurrentGeneration(path, generation)) return;
    if (!dataUrl) {
      safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
      return;
    }

    dataUrlCache.set(path, dataUrl);
    safeDispatch(view, { path, entry: { status: "ready" } });
  } catch {
    if (!isCurrentGeneration(path, generation)) return;
    safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
  } finally {
    if (pendingPaths.get(path) === generation) {
      pendingPaths.delete(path);
    }
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

function safeRemove(view: EditorView, path: string): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: imageUrlRemoveEffect.of(path) });
  } catch {
    // View disconnected between guard and dispatch.
  }
}

function isCurrentGeneration(path: string, generation: number): boolean {
  return pendingPaths.get(path) === generation && (pathGenerations.get(path) ?? 0) === generation;
}
