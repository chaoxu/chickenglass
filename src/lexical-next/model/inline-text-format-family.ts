export type InlineTextFormatFamily =
  | "bold"
  | "code"
  | "highlight"
  | "italic"
  | "strikethrough";

export interface InlineTextFormatSpec {
  readonly family: InlineTextFormatFamily;
  readonly lexicalFormat: InlineTextFormatFamily;
  readonly markdownClose: string;
  readonly markdownOpen: string;
  readonly sharedRuntime: "lexical-text-format";
  readonly themeClassName: string;
}

const INLINE_TEXT_FORMAT_FAMILIES: readonly InlineTextFormatFamily[] = [
  "bold",
  "code",
  "highlight",
  "italic",
  "strikethrough",
];

const INLINE_TEXT_FORMAT_SPECS: Record<InlineTextFormatFamily, InlineTextFormatSpec> = {
  bold: {
    family: "bold",
    lexicalFormat: "bold",
    markdownClose: "**",
    markdownOpen: "**",
    sharedRuntime: "lexical-text-format",
    themeClassName: "cf-bold",
  },
  code: {
    family: "code",
    lexicalFormat: "code",
    markdownClose: "`",
    markdownOpen: "`",
    sharedRuntime: "lexical-text-format",
    themeClassName: "cf-inline-code",
  },
  highlight: {
    family: "highlight",
    lexicalFormat: "highlight",
    markdownClose: "==",
    markdownOpen: "==",
    sharedRuntime: "lexical-text-format",
    themeClassName: "cf-highlight",
  },
  italic: {
    family: "italic",
    lexicalFormat: "italic",
    markdownClose: "*",
    markdownOpen: "*",
    sharedRuntime: "lexical-text-format",
    themeClassName: "cf-italic",
  },
  strikethrough: {
    family: "strikethrough",
    lexicalFormat: "strikethrough",
    markdownClose: "~~",
    markdownOpen: "~~",
    sharedRuntime: "lexical-text-format",
    themeClassName: "cf-strikethrough",
  },
};

const INLINE_TEXT_FORMAT_SPEC_LIST = INLINE_TEXT_FORMAT_FAMILIES.map((family) =>
  INLINE_TEXT_FORMAT_SPECS[family]
);

export function getInlineTextFormatSpec(
  family: InlineTextFormatFamily,
): InlineTextFormatSpec {
  return INLINE_TEXT_FORMAT_SPECS[family];
}

export function getInlineTextFormatSpecs(): readonly InlineTextFormatSpec[] {
  return INLINE_TEXT_FORMAT_SPEC_LIST;
}

export function getInlineTextFormatSelector(): string {
  return INLINE_TEXT_FORMAT_SPEC_LIST.map((spec) => `.${spec.themeClassName}`).join(", ");
}

export function getInlineTextFormatThemeClassNames(): readonly string[] {
  return INLINE_TEXT_FORMAT_SPEC_LIST.map((spec) => spec.themeClassName);
}
