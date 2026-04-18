import type { InsertFocusTarget } from "./block-insert-focus";
import type { InsertBlockVariant } from "./block-insert-node";

export type InsertCatalogId =
  | "code-block"
  | "display-math"
  | "display-math-bracket"
  | "fenced-div"
  | "footnote-definition"
  | "frontmatter"
  | "image"
  | "include"
  | "table";

export type InsertCatalogVariant = InsertBlockVariant | "code-block";

export interface InsertCatalogSpec {
  readonly focusTarget: InsertFocusTarget;
  readonly id: InsertCatalogId;
  readonly raw: string;
  readonly title: string;
  readonly variant: InsertCatalogVariant;
}

export interface SlashInsertSpec extends InsertCatalogSpec {
  readonly keywords: readonly string[];
}

export interface BlockInsertSpec extends InsertCatalogSpec {
  readonly variant: InsertBlockVariant;
}

export const SLASH_INSERT_SPECS: readonly SlashInsertSpec[] = [
  {
    focusTarget: "table-cell",
    id: "table",
    keywords: ["table", "grid", "columns", "rows"],
    raw: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |",
    title: "Table",
    variant: "table",
  },
  {
    focusTarget: "none",
    id: "code-block",
    keywords: ["code", "block", "snippet", "fence"],
    raw: "```\n\n```",
    title: "Code block",
    variant: "code-block",
  },
  {
    focusTarget: "display-math",
    id: "display-math",
    keywords: ["math", "display", "equation", "formula", "latex"],
    raw: "$$\n\n$$",
    title: "Display math",
    variant: "display-math",
  },
  {
    focusTarget: "footnote-body",
    id: "footnote-definition",
    keywords: ["footnote", "note", "annotation"],
    raw: "[^1]: ",
    title: "Footnote",
    variant: "footnote-definition",
  },
  {
    focusTarget: "include-path",
    id: "include",
    keywords: ["include", "import", "file", "embed"],
    raw: ":::: {.include}\n\n::::",
    title: "Include",
    variant: "fenced-div",
  },
  {
    focusTarget: "block-body",
    id: "fenced-div",
    keywords: ["theorem", "definition", "proof", "lemma", "block", "div"],
    raw: "::: {.theorem}\n\n:::",
    title: "Theorem / Definition",
    variant: "fenced-div",
  },
];

export const FRONTMATTER_INSERT_SPEC: BlockInsertSpec = {
  focusTarget: "frontmatter",
  id: "frontmatter",
  raw: "---\ntitle: \n---",
  title: "Frontmatter",
  variant: "frontmatter",
};

export const DISPLAY_MATH_DOLLAR_INSERT_SPEC: BlockInsertSpec = {
  focusTarget: "display-math",
  id: "display-math",
  raw: "$$\n\n$$",
  title: "Display math",
  variant: "display-math",
};

export const DISPLAY_MATH_BRACKET_INSERT_SPEC: BlockInsertSpec = {
  focusTarget: "display-math",
  id: "display-math-bracket",
  raw: "\\[\n\n\\]",
  title: "Display math",
  variant: "display-math",
};

export function createFencedDivInsertSpec(opener: string): BlockInsertSpec {
  const openingFence = opener.match(/^\s*(:{3,})/)?.[1] ?? ":::";
  const focusTarget: InsertFocusTarget = /\{[^}]*\.include\b/.test(opener)
    ? "include-path"
    : "block-body";
  return {
    focusTarget,
    id: focusTarget === "include-path" ? "include" : "fenced-div",
    raw: `${opener}\n\n${openingFence}`,
    title: focusTarget === "include-path" ? "Include" : "Fenced div",
    variant: "fenced-div",
  };
}

export function createFootnoteDefinitionInsertSpec(raw: string): BlockInsertSpec {
  return {
    focusTarget: "footnote-body",
    id: "footnote-definition",
    raw,
    title: "Footnote",
    variant: "footnote-definition",
  };
}

export function createImageInsertSpec(raw: string): BlockInsertSpec {
  return {
    focusTarget: "none",
    id: "image",
    raw,
    title: "Image",
    variant: "image",
  };
}

export function createTableInsertSpec(
  headerLine: string,
  dividerLine: string,
): BlockInsertSpec {
  const cells = headerLine
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  const placeholderRow = cells.length === 0
    ? "|  |"
    : `| ${cells.map(() => "").join(" | ")} |`;

  return {
    focusTarget: "table-cell",
    id: "table",
    raw: `${headerLine}\n${dividerLine}\n${placeholderRow}`,
    title: "Table",
    variant: "table",
  };
}
