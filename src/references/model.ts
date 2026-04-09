export type ReferenceEntryType = "citation" | "crossref" | "label";

export interface ReferenceRange {
  readonly from: number;
  readonly to: number;
}

export interface ReferenceTarget {
  readonly path: string;
  readonly range?: ReferenceRange;
}

export interface ReferenceEntry {
  readonly id: string;
  readonly type: ReferenceEntryType;
  readonly sourceRange: ReferenceRange;
  readonly display: string;
  readonly target: ReferenceTarget | null;
}

export type ReferenceIndexModel = ReadonlyMap<string, ReferenceEntry>;
