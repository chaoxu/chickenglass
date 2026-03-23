/**
 * Constants for Lezer syntax tree node type names.
 *
 * Avoids scattered string literals when matching node types in
 * tree walkers, render plugins, and semantic analysis.
 */

/** Lezer node type names from @lezer/markdown and custom extensions. */
export const NODE = {
  // Headings
  ATXHeading1: "ATXHeading1",
  ATXHeading2: "ATXHeading2",
  ATXHeading3: "ATXHeading3",
  ATXHeading4: "ATXHeading4",
  ATXHeading5: "ATXHeading5",
  ATXHeading6: "ATXHeading6",
  HeaderMark: "HeaderMark",

  // Fenced divs (custom extension)
  FencedDiv: "FencedDiv",
  FencedDivFence: "FencedDivFence",
  FencedDivAttributes: "FencedDivAttributes",

  // Code
  FencedCode: "FencedCode",
  InlineCode: "InlineCode",
  CodeMark: "CodeMark",
  CodeInfo: "CodeInfo",

  // Math (custom extension)
  InlineMath: "InlineMath",
  DisplayMath: "DisplayMath",

  // Lists
  BulletList: "BulletList",
  OrderedList: "OrderedList",
  ListItem: "ListItem",
  ListMark: "ListMark",
  Task: "Task",

  // Block elements
  Paragraph: "Paragraph",
  Blockquote: "Blockquote",
  HorizontalRule: "HorizontalRule",
  HTMLBlock: "HTMLBlock",
  SetextHeading1: "SetextHeading1",
  SetextHeading2: "SetextHeading2",

  // Inline elements
  Link: "Link",
  LinkMark: "LinkMark",
  Image: "Image",
  Escape: "Escape",
  Emphasis: "Emphasis",
  StrongEmphasis: "StrongEmphasis",
  Strikethrough: "Strikethrough",
  Highlight: "Highlight",
  Text: "Text",

  // Footnotes (custom extension)
  FootnoteRef: "FootnoteRef",
  FootnoteDef: "FootnoteDef",

  // Equation labels (custom extension)
  EquationLabel: "EquationLabel",

  // Tables
  Table: "Table",
  TableRow: "TableRow",

  // Frontmatter
  Frontmatter: "Frontmatter",
} as const;

/** Union type of all known Lezer node type names. */
export type NodeTypeName = (typeof NODE)[keyof typeof NODE];
