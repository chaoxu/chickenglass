import { StateEffect, StateField } from "@codemirror/state";

import { type CslJsonItem } from "../citations/bibtex-parser";
import { CslProcessor } from "../citations/csl-processor";

/** A store of bibliography entries keyed by citation id. */
export type BibStore = ReadonlyMap<string, CslJsonItem>;

export type BibliographyFailureKind =
  | "read-bib"
  | "parse-bib"
  | "read-csl"
  | "style-csl"
  | "unexpected";

export type BibliographyStatus =
  | { readonly state: "idle" }
  | {
    readonly state: "ok";
    readonly bibPath: string;
    readonly cslPath?: string;
  }
  | {
    readonly state: "warning";
    readonly kind: BibliographyFailureKind;
    readonly bibPath: string;
    readonly cslPath?: string;
    readonly message: string;
  }
  | {
    readonly state: "error";
    readonly kind: BibliographyFailureKind;
    readonly bibPath: string;
    readonly cslPath?: string;
    readonly message: string;
  };

/** Bibliography data stored in the editor state. */
export interface BibData {
  store: BibStore;
  cslProcessor: CslProcessor;
  status?: BibliographyStatus;
}

interface BibDataState extends BibData {
  readonly processorRevision: number;
  readonly status: BibliographyStatus;
}

/** StateEffect for updating bibliography data. */
export const bibDataEffect = StateEffect.define<BibData>();

function bibDataStatus(value: BibData): BibliographyStatus {
  return value.status ?? { state: "ok", bibPath: "" };
}

/** StateField that holds the current bibliography data. */
export const bibDataField = StateField.define<BibDataState>({
  create() {
    const cslProcessor = CslProcessor.empty();
    return {
      store: new Map(),
      cslProcessor,
      processorRevision: cslProcessor.revision,
      status: { state: "idle" },
    };
  },

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bibDataEffect)) {
        return {
          ...effect.value,
          status: bibDataStatus(effect.value),
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
      a.processorRevision === b.processorRevision &&
      a.status === b.status
    );
  },
});
