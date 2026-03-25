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
}

export interface PdfPreviewUpdate {
  readonly path: string;
  readonly entry: PdfPreviewEntry;
}

// ── StateEffect + StateField ─────────────────────────────────────────────────

export const pdfPreviewEffect = StateEffect.define<PdfPreviewUpdate>();

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
 * - If already cached, returns immediately.
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
  if (existing) return;

  if (pendingPaths.has(path)) return;
  pendingPaths.add(path);

  safeDispatch(view, { path, entry: { status: "loading" } });

  try {
    const bytes = await fs.readFileBinary(path);
    const canvas = await rasterizePdfPage1(bytes);

    if (canvas) {
      // Evict oldest entry when cache is full
      if (canvasCache.size >= MAX_CANVAS_CACHE_SIZE) {
        const oldest = canvasCache.keys().next().value;
        if (oldest !== undefined) canvasCache.delete(oldest);
      }
      canvasCache.set(path, canvas);
      safeDispatch(view, { path, entry: { status: "ready" } });
    } else {
      safeDispatch(view, { path, entry: { status: "error" } });
    }
  } catch {
    safeDispatch(view, { path, entry: { status: "error" } });
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
