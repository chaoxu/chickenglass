export type EditorFieldKind = "inline" | "rich-block" | "source-text";

export interface EditorFieldKindSpec {
  readonly inlineLayout: boolean;
  readonly kind: EditorFieldKind;
  readonly supportsNestedBlocks: boolean;
}

const EDITOR_FIELD_KIND_SPECS: Record<EditorFieldKind, EditorFieldKindSpec> = {
  inline: {
    inlineLayout: true,
    kind: "inline",
    supportsNestedBlocks: false,
  },
  "rich-block": {
    inlineLayout: false,
    kind: "rich-block",
    supportsNestedBlocks: true,
  },
  "source-text": {
    inlineLayout: false,
    kind: "source-text",
    supportsNestedBlocks: false,
  },
};

export function getEditorFieldKindSpec(kind: EditorFieldKind): EditorFieldKindSpec {
  return EDITOR_FIELD_KIND_SPECS[kind];
}
