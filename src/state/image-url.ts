import { StateEffect, StateField } from "@codemirror/state";
import type { MediaEntryBase } from "./pdf-preview";

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
