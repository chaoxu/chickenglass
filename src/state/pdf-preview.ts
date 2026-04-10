import { StateEffect, StateField } from "@codemirror/state";

/** Shared base type for media preview cache entries (images and PDFs). */
export interface MediaEntryBase {
  readonly status: "loading" | "ready" | "error";
  /** For error entries: timestamp (ms) when the error was recorded.
   *  Allows retry after ERROR_COOLDOWN_MS elapses. */
  readonly errorTime?: number;
}

export type PdfPreviewStatus = "loading" | "ready" | "error";

export interface PdfPreviewEntry extends MediaEntryBase {
  readonly status: PdfPreviewStatus;
}

export interface PdfPreviewUpdate {
  readonly path: string;
  readonly entry: PdfPreviewEntry;
}

/** Minimum time (ms) before an errored PDF preview can be retried. */
export const ERROR_COOLDOWN_MS = 10_000;

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
  compare(a, b) {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const [key, entryA] of a) {
      const entryB = b.get(key);
      if (
        !entryB ||
        entryA.status !== entryB.status ||
        entryA.errorTime !== entryB.errorTime
      ) {
        return false;
      }
    }
    return true;
  },
});
