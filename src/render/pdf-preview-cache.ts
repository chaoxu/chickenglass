/**
 * PDF preview cache — a CM6 StateField that stores rasterized first-page
 * previews of PDF files, plus an async loader that coordinates binary file
 * reading with PDF rasterization.
 *
 * Pattern follows citation-render.ts: StateEffect injects async results into
 * a StateField that render plugins can read synchronously.
 */
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rasterizePdfPage1 } from "./pdf-rasterizer";
import type { FileSystem } from "../lib/types";

// ── Types ────────────────────────────────────────────────────────────────────

/** Status of a single PDF preview entry. */
export type PdfPreviewStatus = "loading" | "ready" | "error";

/** A cached PDF preview entry. */
export interface PdfPreviewEntry {
  readonly status: PdfPreviewStatus;
  /** data:image/png URL when status is "ready"; undefined otherwise. */
  readonly dataUrl?: string;
}

/** Payload dispatched via the state effect to update the cache. */
export interface PdfPreviewUpdate {
  readonly path: string;
  readonly entry: PdfPreviewEntry;
}

// ── StateEffect + StateField ─────────────────────────────────────────────────

/** Effect to inject a PDF preview result (loading / ready / error). */
export const pdfPreviewEffect = StateEffect.define<PdfPreviewUpdate>();

/** StateField holding rasterized PDF preview entries keyed by relative path. */
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

// ── Async loader ─────────────────────────────────────────────────────────────

/**
 * Module-level deduplication set. Prevents concurrent requests for the same
 * path when multiple render cycles fire before the first resolves.
 */
const pendingPaths = new Set<string>();

/** Exported for testing only — clears the deduplication set. */
export function _resetPendingPaths(): void {
  pendingPaths.clear();
}

/**
 * Request a rasterized preview of page 1 of a PDF file.
 *
 * - If `path` is already in the cache (loading/ready/error), returns immediately.
 * - Otherwise dispatches a "loading" entry, reads the binary, rasterizes, and
 *   dispatches "ready" or "error".
 * - Uses `pendingPaths` to deduplicate concurrent requests.
 * - Error entries are cached permanently to avoid retry storms.
 * - Dispatches are guarded against disconnected views (editor teardown race).
 */
export async function requestPdfPreview(
  view: EditorView,
  path: string,
  fs: FileSystem,
): Promise<void> {
  // Already cached (any status) — nothing to do.
  const existing = view.state.field(pdfPreviewField).get(path);
  if (existing) return;

  // Another call is already in flight for this path.
  if (pendingPaths.has(path)) return;
  pendingPaths.add(path);

  // Dispatch "loading" entry.
  safeDispatch(view, { path, entry: { status: "loading" } });

  try {
    const bytes = await fs.readFileBinary(path);
    const dataUrl = await rasterizePdfPage1(bytes);

    if (dataUrl) {
      safeDispatch(view, { path, entry: { status: "ready", dataUrl } });
    } else {
      // rasterizePdfPage1 returns "" on failure (corrupt PDF, etc.)
      safeDispatch(view, { path, entry: { status: "error" } });
    }
  } catch {
    // readFileBinary failure (missing file, permission error, etc.)
    safeDispatch(view, { path, entry: { status: "error" } });
  } finally {
    pendingPaths.delete(path);
  }
}

/**
 * Dispatch a PDF preview effect, silently skipping if the view's DOM is no
 * longer connected (editor was unmounted while the async work was in flight).
 */
function safeDispatch(view: EditorView, update: PdfPreviewUpdate): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: pdfPreviewEffect.of(update) });
  } catch {
    // View disconnected between the guard check and dispatch — expected race.
  }
}
