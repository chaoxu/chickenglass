/**
 * PDF preview cache — a CM6 StateField that tracks PDF preview status,
 * plus an async loader that coordinates binary file reading with PDF
 * rasterization. The actual canvas elements are stored in a module-level
 * cache (not in CM6 state, since DOM elements aren't serializable).
 */
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rasterizePdfPage1 } from "./pdf-rasterizer";
import type { FileSystem } from "../lib/types";

// ── Types ────────────────────────────────────────────────────────────────────

export type PdfPreviewStatus = "loading" | "ready" | "error";

export interface PdfPreviewEntry {
  readonly status: PdfPreviewStatus;
  /** For error entries: timestamp (ms) when the error was recorded.
   *  Allows retry after ERROR_COOLDOWN_MS elapses. */
  readonly errorTime?: number;
}

export interface PdfPreviewUpdate {
  readonly path: string;
  readonly entry: PdfPreviewEntry;
}

/** Minimum time (ms) before an errored PDF preview can be retried. */
export const ERROR_COOLDOWN_MS = 10_000;

// ── StateEffect + StateField ─────────────────────────────────────────────────

export const pdfPreviewEffect = StateEffect.define<PdfPreviewUpdate>();

/** Effect to remove a path from the StateField (used on canvas eviction). */
export const pdfPreviewRemoveEffect = StateEffect.define<string>();

/** StateField tracking PDF preview status keyed by resolved path. */
export const pdfPreviewField = StateField.define<
  ReadonlyMap<string, PdfPreviewEntry>
>({
  create() {
    return new Map();
  },
  update(value, tr) {
    let updated: Map<string, PdfPreviewEntry> | null = null;
    for (const effect of tr.effects) {
      if (effect.is(pdfPreviewEffect)) {
        if (!updated) updated = new Map(value);
        updated.set(effect.value.path, effect.value.entry);
      } else if (effect.is(pdfPreviewRemoveEffect)) {
        if (value.has(effect.value)) {
          if (!updated) updated = new Map(value);
          updated.delete(effect.value);
        }
      }
    }
    return updated ?? value;
  },
});

// ── Canvas cache (module-level, not in CM6 state) ────────────────────────────

const MAX_CANVAS_CACHE_SIZE = 64;
const canvasCache = new Map<string, HTMLCanvasElement>();
const pendingPaths = new Set<string>();

/** Get a cached canvas for a resolved PDF path. */
export function getPdfCanvas(path: string): HTMLCanvasElement | undefined {
  return canvasCache.get(path);
}

/** Exported for testing only — clears all module-level caches. */
export function _resetPendingPaths(): void {
  pendingPaths.clear();
  canvasCache.clear();
}

// ── Async loader ─────────────────────────────────────────────────────────────

/**
 * Request a rasterized preview of page 1 of a PDF file.
 *
 * - If already cached and canvas is present, returns immediately.
 * - Error entries are retried after ERROR_COOLDOWN_MS elapses.
 * - Otherwise dispatches "loading", reads binary, rasterizes to canvas,
 *   stores canvas in module cache, dispatches "ready" or "error".
 * - Deduplicates concurrent requests via pendingPaths.
 */
export async function requestPdfPreview(
  view: EditorView,
  path: string,
  fs: FileSystem,
): Promise<void> {
  const existing = view.state.field(pdfPreviewField).get(path);

  if (existing) {
    // #486/#473: "ready" with canvas still in cache — nothing to do
    if (existing.status === "ready" && canvasCache.has(path)) return;

    // #472: error entries can be retried after cooldown
    if (existing.status === "error") {
      const elapsed = Date.now() - (existing.errorTime ?? 0);
      if (elapsed < ERROR_COOLDOWN_MS) return;
      // Cooldown expired — fall through to retry
    }

    // "loading" — already in progress
    if (existing.status === "loading") return;
  }

  if (pendingPaths.has(path)) return;
  pendingPaths.add(path);

  safeDispatch(view, { path, entry: { status: "loading" } });

  try {
    const bytes = await fs.readFileBinary(path);
    const canvas = await rasterizePdfPage1(bytes);

    if (canvas) {
      // Evict oldest entry when cache is full.
      // #486: also reset the StateField entry for the evicted path so the
      // next decoration pass sees a cache miss and re-requests.
      if (canvasCache.size >= MAX_CANVAS_CACHE_SIZE) {
        const oldest = canvasCache.keys().next().value;
        if (oldest !== undefined) {
          canvasCache.delete(oldest);
          safeRemove(view, oldest);
        }
      }
      canvasCache.set(path, canvas);
      safeDispatch(view, { path, entry: { status: "ready" } });
    } else {
      safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
    }
  } catch {
    safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
  } finally {
    pendingPaths.delete(path);
  }
}

function safeDispatch(view: EditorView, update: PdfPreviewUpdate): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: pdfPreviewEffect.of(update) });
  } catch {
    // View disconnected between guard and dispatch — expected race
  }
}

function safeRemove(view: EditorView, path: string): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: pdfPreviewRemoveEffect.of(path) });
  } catch {
    // View disconnected between guard and dispatch — expected race
  }
}
