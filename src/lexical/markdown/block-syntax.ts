import { normalizeBlockType } from "./block-metadata";
import {
  collectSourceBlockRanges,
  FENCED_DIV_START_RE,
  type SourceBlockRange,
} from "./block-scanner";
import { findMatchingBrace } from "../../parser/char-utils";
import { parseFencedDivAttrs as parseCanonicalFencedDivAttrs } from "../../parser/fenced-div-attrs";
import { parseBracedId } from "../../parser/label-utils";

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
  readonly titleKind: "attribute" | "none";
}

export interface DisplayMathInfo {
  readonly body: string;
  readonly id?: string;
}

export interface ParsedDisplayMathBlock extends DisplayMathInfo {
  readonly bodyMarkdown: string;
  readonly closingDelimiter: "\\]" | "$$" | "\\end{equation}" | "\\end{equation*}";
  readonly labelFrom?: number;
  readonly labelSuffix: string;
  readonly labelTo?: number;
  readonly openingDelimiter: "\\[" | "$$" | "\\begin{equation}" | "\\begin{equation*}";
}

const DISPLAY_MATH_LABEL_SUFFIX_RE = /^\s*(\{#[^}\s]+\})\s*$/;

function parseDisplayMathLabelSuffix(
  text: string,
  offset: number,
): {
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelSuffix: string;
  readonly labelTo?: number;
} | null {
  const match = text.match(DISPLAY_MATH_LABEL_SUFFIX_RE);
  if (!match?.[1]) {
    return null;
  }
  const id = parseBracedId(match[1], "eq:") ?? undefined;
  const braceIndex = text.indexOf(match[1]);
  return {
    id,
    labelFrom: id ? offset + braceIndex + "{#".length : undefined,
    labelSuffix: match[1],
    labelTo: id ? offset + braceIndex + "{#".length + id.length : undefined,
  };
}

export type SpecialBlockRange = SourceBlockRange & {
  readonly variant: "display-math" | "fenced-div";
};

export function parseDisplayMathRaw(raw: string): DisplayMathInfo {
  const parsed = parseStructuredDisplayMathRaw(raw);
  return {
    body: parsed.body,
    id: parsed.id,
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
    const blockType = normalizeBlockType(header ? header.toLowerCase() : undefined, undefined);
    return {
      blockType,
      body,
      bodyMarkdown,
      closingFence,
      fence,
      title: undefined,
      titleMarkdown: undefined,
      titleKind: "none",
    };
  }

  const attrsEnd = findMatchingBrace(header, 0);
  const attrs = attrsEnd >= 0 ? header.slice(0, attrsEnd) : header;
  const parsedAttrs = parseCanonicalFencedDivAttrs(attrs);
  const titleAttribute = parsedAttrs?.keyValues.title;

  return {
    attrsRaw: attrs,
    blockType: normalizeBlockType(parsedAttrs?.classes[0], titleAttribute),
    body,
    bodyMarkdown,
    closingFence,
    fence,
    id: parsedAttrs?.id,
    title: titleAttribute,
    titleMarkdown: titleAttribute,
    titleKind: titleAttribute !== undefined ? "attribute" : "none",
  };
}

function serializeTitleAttribute(title: string): string {
  return `title=${JSON.stringify(title)}`;
}

function upsertTitleAttribute(attrsRaw: string, titleMarkdown: string): string {
  const withoutTitle = attrsRaw
    .replace(/\s*\btitle=(?:"[^"]*"|'[^']*')/g, "")
    .replace(/\{\s+/, "{")
    .replace(/\s+\}/, "}");
  if (!titleMarkdown) {
    return withoutTitle;
  }
  return withoutTitle.replace(/\}$/, (withoutTitle.endsWith("{") ? "" : " ") + serializeTitleAttribute(titleMarkdown) + "}");
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
  const attrsRaw = parsed.attrsRaw ? upsertTitleAttribute(parsed.attrsRaw, titleMarkdown) : undefined;
  const header = attrsRaw
    ? attrsRaw
    : parsed.blockType;
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
  if (title) {
    attrs.push(serializeTitleAttribute(title));
  }

  const header = attrs.length > 0
    ? `{${attrs.join(" ")}}`
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
  const equationMatch = firstLine.match(/^\\begin\{(equation\*?)\}(?:\s*\\label\{([A-Za-z][\w.:-]*)\})?\s*$/);
  if (equationMatch) {
    const environment = equationMatch[1] as "equation" | "equation*";
    const rawLabelId = equationMatch[2];
    const bodyMarkdown = lines.slice(1, -1).join("\n");
    return {
      body: bodyMarkdown.trim(),
      bodyMarkdown,
      closingDelimiter: `\\end{${environment}}`,
      id: undefined,
      labelFrom: undefined,
      labelSuffix: rawLabelId ? `\\label{${rawLabelId}}` : "",
      labelTo: undefined,
      openingDelimiter: `\\begin{${environment}}`,
    };
  }

  if (firstLine.startsWith("\\[")) {
    const openingIndex = raw.indexOf("\\[");
    const sameLineClosingIndex = lines.length === 1
      ? raw.indexOf("\\]", openingIndex + 2)
      : -1;
    if (sameLineClosingIndex >= 0) {
      const label = parseDisplayMathLabelSuffix(
        raw.slice(sameLineClosingIndex + 2),
        sameLineClosingIndex + 2,
      );
      const bodyMarkdown = raw.slice(openingIndex + 2, sameLineClosingIndex);

      return {
        body: bodyMarkdown.trim(),
        bodyMarkdown,
        closingDelimiter: "\\]",
        id: label?.id,
        labelFrom: label?.labelFrom,
        labelSuffix: label?.labelSuffix ?? "",
        labelTo: label?.labelTo,
        openingDelimiter: "\\[",
      };
    }

    const closingLine = lines[lines.length - 1] ?? "";
    const closingLineOffset = raw.length - closingLine.length;
    const closingDelimiterMatch = closingLine.match(/^\s*\\\]/);
    const labelOffset = closingLineOffset + (closingDelimiterMatch?.[0].length ?? 0);
    const label = parseDisplayMathLabelSuffix(
      closingLine.slice(closingDelimiterMatch?.[0].length ?? 0),
      labelOffset,
    );
    const bodyMarkdown = lines.slice(1, -1).join("\n");

    return {
      body: bodyMarkdown.trim(),
      bodyMarkdown,
      closingDelimiter: "\\]",
      id: label?.id,
      labelFrom: label?.labelFrom,
      labelSuffix: label?.labelSuffix ?? "",
      labelTo: label?.labelTo,
      openingDelimiter: "\\[",
    };
  }

  const openingIndex = raw.indexOf("$$");
  const sameLineClosingIndex = lines.length === 1
    ? raw.indexOf("$$", openingIndex + 2)
    : -1;
  if (sameLineClosingIndex >= 0) {
    const label = parseDisplayMathLabelSuffix(
      raw.slice(sameLineClosingIndex + 2),
      sameLineClosingIndex + 2,
    );
    const bodyMarkdown = raw.slice(openingIndex + 2, sameLineClosingIndex);

    return {
      body: bodyMarkdown.trim(),
      bodyMarkdown,
      closingDelimiter: "$$",
      id: label?.id,
      labelFrom: label?.labelFrom,
      labelSuffix: label?.labelSuffix ?? "",
      labelTo: label?.labelTo,
      openingDelimiter: "$$",
    };
  }

  const closingLine = lines[lines.length - 1] ?? "";
  const closingLineOffset = raw.length - closingLine.length;
  const closingDelimiterMatch = closingLine.match(/^\s*\$\$/);
  const labelOffset = closingLineOffset + (closingDelimiterMatch?.[0].length ?? 0);
  const label = parseDisplayMathLabelSuffix(
    closingLine.slice(closingDelimiterMatch?.[0].length ?? 0),
    labelOffset,
  );
  const bodyMarkdown = lines.slice(1, -1).join("\n");

  return {
    body: bodyMarkdown.trim(),
    bodyMarkdown,
    closingDelimiter: "$$",
    id: label?.id,
    labelFrom: label?.labelFrom,
    labelSuffix: label?.labelSuffix ?? "",
    labelTo: label?.labelTo,
    openingDelimiter: "$$",
  };
}

export function serializeDisplayMathRaw(
  parsed: ParsedDisplayMathBlock,
  bodyMarkdown: string,
): string {
  if (parsed.openingDelimiter.startsWith("\\begin{equation")) {
    return [
      `${parsed.openingDelimiter}${parsed.labelSuffix}`,
      bodyMarkdown,
      parsed.closingDelimiter,
    ].join("\n");
  }

  const closingLine = `${parsed.closingDelimiter}${parsed.labelSuffix ? ` ${parsed.labelSuffix}` : ""}`;
  return [
    parsed.openingDelimiter,
    bodyMarkdown,
    closingLine,
  ].join("\n");
}

export function collectSpecialBlockRanges(markdown: string): SpecialBlockRange[] {
  return collectSourceBlockRanges(markdown).filter((range): range is SpecialBlockRange =>
    range.variant === "display-math"
    || (range.variant === "fenced-div"
      && Boolean((range.raw.split("\n")[0] ?? "").match(FENCED_DIV_START_RE)?.[2]?.trim()))
  );
}
