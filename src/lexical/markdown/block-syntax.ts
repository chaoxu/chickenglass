import { humanizeBlockType, normalizeBlockType } from "./block-metadata";

const FENCED_DIV_START_RE = /^\s*(:{3,})(.*)$/;
const DISPLAY_MATH_DOLLAR_START_RE = /^\s*\$\$(?!\$).*$/;
const DISPLAY_MATH_DOLLAR_END_RE = /^\s*\$\$(?:\s+\{#[^}]+\})?\s*$/;
const DISPLAY_MATH_BRACKET_START_RE = /^\s*\\\[\s*$/;
const DISPLAY_MATH_BRACKET_END_RE = /^\s*\\\](?:\s+\{#[^}]+\})?\s*$/;

export interface FencedDivInfo {
  readonly blockType: string;
  readonly body: string;
  readonly id?: string;
  readonly title?: string;
}

export interface ParsedFencedDivBlock extends FencedDivInfo {
  readonly attrsRaw?: string;
  readonly bodyMarkdown: string;
  readonly closingFence: string;
  readonly fence: string;
  readonly titleMarkdown?: string;
  readonly titleKind: "attribute" | "implicit" | "none" | "trailing";
}

export interface DisplayMathInfo {
  readonly body: string;
  readonly id?: string;
}

export interface ParsedDisplayMathBlock extends DisplayMathInfo {
  readonly bodyMarkdown: string;
  readonly closingDelimiter: "\\]" | "$$";
  readonly labelSuffix: string;
  readonly openingDelimiter: "\\[" | "$$";
}

export interface SpecialBlockRange {
  readonly from: number;
  readonly raw: string;
  readonly to: number;
  readonly variant: "display-math" | "fenced-div";
}

export function parseDisplayMathRaw(raw: string): DisplayMathInfo {
  const lines = raw.split("\n");
  if (lines[0]?.trimStart().startsWith("$$")) {
    const lastLine = lines[lines.length - 1] ?? "";
    const body = lines.length === 1
      ? raw.slice(raw.indexOf("$$") + 2, raw.lastIndexOf("$$")).trim()
      : lines.slice(1, -1).join("\n").trim();
    return {
      body,
      id: lastLine.match(/\{#([^}]+)\}\s*$/)?.[1],
    };
  }
  return {
    body: lines.slice(1, -1).join("\n").trim(),
    id: (lines[lines.length - 1] ?? "").match(/\{#([^}]+)\}\s*$/)?.[1],
  };
}

export function parseFencedDivRaw(raw: string): FencedDivInfo {
  const parsed = parseStructuredFencedDivRaw(raw);
  return {
    blockType: parsed.blockType,
    body: parsed.body,
    id: parsed.id,
    title: parsed.title,
  };
}

export function parseStructuredFencedDivRaw(raw: string): ParsedFencedDivBlock {
  const lines = raw.split("\n");
  const opener = lines[0] ?? "";
  const fenceMatch = opener.match(/^\s*(:{3,})/);
  const fence = fenceMatch?.[1] ?? ":::";
  const header = opener.replace(/^\s*:{3,}/, "").trim();
  const closingFence = lines[lines.length - 1]?.trim() || fence;
  const bodyMarkdown = lines.slice(1, -1).join("\n");
  const body = bodyMarkdown.trim();

  if (!header.startsWith("{")) {
    return {
      blockType: normalizeBlockType(undefined, header || "block"),
      body,
      bodyMarkdown,
      closingFence,
      fence,
      title: header || undefined,
      titleMarkdown: header || undefined,
      titleKind: header ? "implicit" : "none",
    };
  }

  const attrsEnd = header.indexOf("}");
  const attrs = attrsEnd >= 0 ? header.slice(0, attrsEnd + 1) : header;
  const trailingTitle = attrsEnd >= 0 ? header.slice(attrsEnd + 1).trim() : "";
  const titleAttrMatch = attrs.match(/\btitle=(?:"([^"]*)"|'([^']*)')/);
  const classes = [...attrs.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]);
  const id = attrs.match(/#([A-Za-z0-9_][\w.:-]*)/)?.[1];

  return {
    attrsRaw: attrs,
    blockType: normalizeBlockType(classes[0], trailingTitle || titleAttrMatch?.[1] || titleAttrMatch?.[2]),
    body,
    bodyMarkdown,
    closingFence,
    fence,
    id,
    title: titleAttrMatch?.[1] || titleAttrMatch?.[2] || trailingTitle || undefined,
    titleMarkdown: trailingTitle || titleAttrMatch?.[1] || titleAttrMatch?.[2] || undefined,
    titleKind: trailingTitle
      ? "trailing"
      : titleAttrMatch
        ? "attribute"
        : "none",
  };
}

export function serializeFencedDivRaw(
  parsed: ParsedFencedDivBlock,
  overrides?: {
    readonly bodyMarkdown?: string;
    readonly titleMarkdown?: string;
  },
): string {
  const bodyMarkdown = overrides?.bodyMarkdown ?? parsed.bodyMarkdown;
  const titleMarkdown = overrides?.titleMarkdown ?? parsed.titleMarkdown ?? "";
  const attrsRaw = parsed.titleKind === "attribute" && parsed.attrsRaw
    ? parsed.attrsRaw.replace(
        /\btitle=(?:"([^"]*)"|'([^']*)')/,
        `title=${JSON.stringify(titleMarkdown)}`,
      )
    : parsed.attrsRaw;
  const header = attrsRaw
    ? `${attrsRaw}${parsed.titleKind === "trailing" && titleMarkdown ? ` ${titleMarkdown}` : ""}`
    : titleMarkdown || parsed.title || humanizeBlockType(parsed.blockType);
  return [
    `${parsed.fence}${header ? ` ${header}` : ""}`,
    bodyMarkdown,
    parsed.closingFence,
  ].join("\n");
}

export function buildPreviewFencedDivRaw({
  blockType,
  bodyMarkdown,
  id,
  title,
}: {
  readonly blockType?: string;
  readonly bodyMarkdown: string;
  readonly id?: string;
  readonly title?: string;
}): string {
  const attrs: string[] = [];
  if (blockType) {
    attrs.push(`.${blockType}`);
  }
  if (id) {
    attrs.push(`#${id}`);
  }

  const header = attrs.length > 0
    ? `{${attrs.join(" ")}}${title ? ` ${title}` : ""}`
    : title ?? "";

  return [
    `:::${header ? ` ${header}` : ""}`,
    bodyMarkdown,
    ":::",
  ].join("\n");
}

export function parseStructuredDisplayMathRaw(raw: string): ParsedDisplayMathBlock {
  const lines = raw.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const lastLine = lines[lines.length - 1]?.trim() ?? "";
  if (firstLine.startsWith("\\[")) {
    return {
      body: lines.slice(1, -1).join("\n").trim(),
      bodyMarkdown: lines.slice(1, -1).join("\n"),
      closingDelimiter: "\\]",
      id: lastLine.match(/\{#([^}]+)\}\s*$/)?.[1],
      labelSuffix: lastLine.replace(/^\\\]/, "").trim(),
      openingDelimiter: "\\[",
    };
  }

  const bodyMarkdown = lines.length === 1
    ? raw.slice(raw.indexOf("$$") + 2, raw.lastIndexOf("$$"))
    : lines.slice(1, -1).join("\n");

  return {
    body: bodyMarkdown.trim(),
    bodyMarkdown,
    closingDelimiter: "$$",
    id: lastLine.match(/\{#([^}]+)\}\s*$/)?.[1],
    labelSuffix: lastLine.replace(/^\$\$/, "").trim(),
    openingDelimiter: "$$",
  };
}

export function serializeDisplayMathRaw(
  parsed: ParsedDisplayMathBlock,
  bodyMarkdown: string,
): string {
  const closingLine = `${parsed.closingDelimiter}${parsed.labelSuffix ? ` ${parsed.labelSuffix}` : ""}`;
  return [
    parsed.openingDelimiter,
    bodyMarkdown,
    closingLine,
  ].join("\n");
}

function matchDisplayMathRange(lines: readonly string[], startLineIndex: number): number | null {
  const startLine = lines[startLineIndex] ?? "";
  if (DISPLAY_MATH_DOLLAR_START_RE.test(startLine)) {
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_DOLLAR_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }
  if (DISPLAY_MATH_BRACKET_START_RE.test(startLine)) {
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_BRACKET_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }
  return null;
}

export function collectSpecialBlockRanges(markdown: string): SpecialBlockRange[] {
  const ranges: SpecialBlockRange[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";

    const fencedMatch = line.match(FENCED_DIV_START_RE);
    if (fencedMatch) {
      const fenceLength = fencedMatch[1].length;
      if (!/^\s*$/.test(fencedMatch[2])) {
        const closingFence = new RegExp(`^\\s*:{${fenceLength},}\\s*$`);
        let depth = 0;
        for (let innerIndex = lineIndex; innerIndex < lines.length; innerIndex += 1) {
          const innerLine = lines[innerIndex] ?? "";
          const innerMatch = innerLine.match(FENCED_DIV_START_RE);
          if (innerMatch && !/^\s*$/.test(innerMatch[2])) {
            depth += 1;
          } else if (closingFence.test(innerLine)) {
            depth -= 1;
            if (depth === 0) {
              const from = lineOffsets[lineIndex];
              const to = lineOffsets[innerIndex] + innerLine.length;
              ranges.push({
                from,
                raw: markdown.slice(from, to),
                to,
                variant: "fenced-div",
              });
              lineIndex = innerIndex;
              break;
            }
          }
        }
      }
      continue;
    }

    const displayMathEndLine = matchDisplayMathRange(lines, lineIndex);
    if (displayMathEndLine !== null) {
      const from = lineOffsets[lineIndex];
      const to = lineOffsets[displayMathEndLine] + (lines[displayMathEndLine] ?? "").length;
      ranges.push({
        from,
        raw: markdown.slice(from, to),
        to,
        variant: "display-math",
      });
      lineIndex = displayMathEndLine;
    }
  }

  return ranges;
}
