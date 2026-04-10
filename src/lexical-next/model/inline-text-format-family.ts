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
}

const INLINE_TEXT_FORMAT_SPECS: Record<InlineTextFormatFamily, InlineTextFormatSpec> = {
  bold: {
    family: "bold",
    lexicalFormat: "bold",
    markdownClose: "**",
    markdownOpen: "**",
    sharedRuntime: "lexical-text-format",
  },
  code: {
    family: "code",
    lexicalFormat: "code",
    markdownClose: "`",
    markdownOpen: "`",
    sharedRuntime: "lexical-text-format",
  },
  highlight: {
    family: "highlight",
    lexicalFormat: "highlight",
    markdownClose: "==",
    markdownOpen: "==",
    sharedRuntime: "lexical-text-format",
  },
  italic: {
    family: "italic",
    lexicalFormat: "italic",
    markdownClose: "*",
    markdownOpen: "*",
    sharedRuntime: "lexical-text-format",
  },
  strikethrough: {
    family: "strikethrough",
    lexicalFormat: "strikethrough",
    markdownClose: "~~",
    markdownOpen: "~~",
    sharedRuntime: "lexical-text-format",
  },
};

export function getInlineTextFormatSpec(
  family: InlineTextFormatFamily,
): InlineTextFormatSpec {
  return INLINE_TEXT_FORMAT_SPECS[family];
}
