import { StateEffect, StateField } from "@codemirror/state";

import { type CslJsonItem } from "../citations/bibtex-parser";
import { CslProcessor } from "../citations/csl-processor";

/** A store of bibliography entries keyed by citation id. */
export type BibStore = ReadonlyMap<string, CslJsonItem>;

/** Bibliography data stored in the editor state. */
export interface BibData {
  store: BibStore;
  cslProcessor: CslProcessor;
}

interface BibDataState extends BibData {
  readonly processorRevision: number;
}

/** StateEffect for updating bibliography data. */
export const bibDataEffect = StateEffect.define<BibData>();

/** StateField that holds the current bibliography data. */
export const bibDataField = StateField.define<BibDataState>({
  create() {
    const cslProcessor = CslProcessor.empty();
    return { store: new Map(), cslProcessor, processorRevision: cslProcessor.revision };
  },

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bibDataEffect)) {
        return {
          ...effect.value,
          processorRevision: effect.value.cslProcessor.revision,
        };
      }
    }

    if (value.processorRevision !== value.cslProcessor.revision) {
      return {
        ...value,
        processorRevision: value.cslProcessor.revision,
      };
    }

    return value;
  },

  compare(a, b) {
    return (
      a.store === b.store &&
      a.cslProcessor === b.cslProcessor &&
      a.processorRevision === b.processorRevision
    );
  },
});
