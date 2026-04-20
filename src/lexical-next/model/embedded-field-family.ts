import type { EditorFieldKind } from "./editor-field-kind";

export type EmbeddedFieldFamily =
  | "block-body"
  | "block-opener"
  | "caption"
  | "footnote-body"
  | "table-cell"
  | "title";

export interface EmbeddedFieldFamilySpec {
  readonly family: EmbeddedFieldFamily;
  readonly fieldKind: EditorFieldKind;
  readonly needsSingleLineLayout: boolean;
}

const EMBEDDED_FIELD_FAMILY_SPECS: Record<EmbeddedFieldFamily, EmbeddedFieldFamilySpec> = {
  "block-body": {
    family: "block-body",
    fieldKind: "rich-block",
    needsSingleLineLayout: false,
  },
  "block-opener": {
    family: "block-opener",
    fieldKind: "source-text",
    needsSingleLineLayout: true,
  },
  caption: {
    family: "caption",
    fieldKind: "inline",
    needsSingleLineLayout: true,
  },
  "footnote-body": {
    family: "footnote-body",
    fieldKind: "rich-block",
    needsSingleLineLayout: false,
  },
  "table-cell": {
    family: "table-cell",
    fieldKind: "rich-block",
    needsSingleLineLayout: false,
  },
  title: {
    family: "title",
    fieldKind: "inline",
    needsSingleLineLayout: true,
  },
};

export function getEmbeddedFieldFamilySpec(
  family: EmbeddedFieldFamily,
): EmbeddedFieldFamilySpec {
  return EMBEDDED_FIELD_FAMILY_SPECS[family];
}
