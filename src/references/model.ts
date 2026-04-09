export type ReferenceEntryType = "citation" | "crossref" | "label";

export interface ReferenceRange {
  readonly from: number;
  readonly to: number;
}

export interface ReferenceTarget {
  readonly path: string;
  readonly range?: ReferenceRange;
}

export type ReferenceTargetKind = "block" | "equation" | "heading";

interface ReferenceEntryBase {
  readonly id: string;
  readonly sourceRange: ReferenceRange;
  readonly display: string;
  readonly target: ReferenceTarget | null;
}

export interface CitationReferenceEntry extends ReferenceEntryBase {
  readonly type: "citation";
  readonly target: null;
}

interface LocalReferenceEntryBase extends ReferenceEntryBase {
  readonly target: ReferenceTarget;
  readonly targetKind: ReferenceTargetKind;
  readonly number?: string;
  readonly ordinal?: number;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
}

export interface CrossrefReferenceEntry extends LocalReferenceEntryBase {
  readonly type: "crossref";
  readonly targetKind: "block" | "heading";
}

export interface LabelReferenceEntry extends LocalReferenceEntryBase {
  readonly type: "label";
  readonly targetKind: "equation";
}

export type ReferenceEntry =
  | CitationReferenceEntry
  | CrossrefReferenceEntry
  | LabelReferenceEntry;

export type ReferenceIndexModel = ReadonlyMap<string, ReferenceEntry>;
