import { $isLinkNode, type LinkNode } from "@lexical/link";
import { $isElementNode, $isTextNode, type LexicalNode, type TextNode } from "lexical";

import { getInlineTextFormatSpecs } from "../runtime";
import type { InlineTextFormatSpec } from "../runtime";
import { $isFootnoteReferenceNode } from "../nodes/footnote-reference-node";
import { $isHeadingAttributeNode } from "../nodes/heading-attribute-node";
import { $isInlineImageNode } from "../nodes/inline-image-node";
import { $isInlineMathNode } from "../nodes/inline-math-node";
import { $isReferenceNode } from "../nodes/reference-node";

export interface ParsedMarkdownLinkSource {
  readonly labelMarkdown: string;
  readonly raw: string;
  readonly title: string | null;
  readonly url: string;
}

export interface MarkdownLinkSourceMatch extends ParsedMarkdownLinkSource {
  readonly from: number;
  readonly to: number;
}

export interface MarkdownFormattedTextSourceMatch {
  readonly closeLength: number;
  readonly from: number;
  readonly openLength: number;
  readonly source: string;
  readonly to: number;
}

const MARKDOWN_ESCAPE_RE = /\\([\\`*{}[\]()#+\-.!_>"])/g;

function unescapeMarkdownSource(value: string): string {
  return value.replace(MARKDOWN_ESCAPE_RE, "$1");
}

function escapeLinkTitle(value: string): string {
  return value.replace(/([\\"])/g, "\\$1");
}

function markdownLabelVisibleText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\$\s*([^$]+?)\s*\$/g, "$1")
    .replace(/\\\(([\s\S]+?)\\\)/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1")
    .replace(/~~([\s\S]+?)~~/g, "$1")
    .replace(/==([\s\S]+?)==/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([\s\S]+?)\*/g, "$1")
    .replace(/_([\s\S]+?)_/g, "$1");
}

function wrapFormattedTextSource(text: string, node: TextNode): string {
  const specs = getInlineTextFormatSpecs().filter((spec) => node.hasFormat(spec.lexicalFormat));
  if (specs.length === 0) {
    return text;
  }
  const open = specs.map((spec) => spec.markdownOpen).join("");
  const close = [...specs].reverse().map((spec) => spec.markdownClose).join("");
  return `${open}${text}${close}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findLabelEnd(markdown: string, labelStart: number): number {
  let depth = 0;
  for (let index = labelStart; index < markdown.length; index += 1) {
    const char = markdown[index];
    if (isEscaped(markdown, index)) {
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findLinkDestinationEnd(markdown: string, openParen: number): number {
  let depth = 0;
  let inAngleDestination = false;
  for (let index = openParen; index < markdown.length; index += 1) {
    const char = markdown[index];
    if (isEscaped(markdown, index)) {
      continue;
    }
    if (inAngleDestination) {
      if (char === ">") {
        inAngleDestination = false;
      }
      continue;
    }
    if (char === "<" && index === openParen + 1) {
      inAngleDestination = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function readBalancedBareDestination(value: string): {
  readonly raw: string;
  readonly rest: string;
} | null {
  let depth = 0;
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (/\s/.test(char) && depth === 0) {
      break;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    index += 1;
  }
  if (index === 0 || depth !== 0) {
    return null;
  }
  return {
    raw: value.slice(0, index),
    rest: value.slice(index).trim(),
  };
}

function readQuotedTitle(value: string): string | null {
  if (value === "") {
    return null;
  }
  const opener = value[0];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== "\"" && opener !== "'" && opener !== "(") {
    return null;
  }
  if (!value.endsWith(closer)) {
    return null;
  }
  const body = value.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === closer && !isEscaped(body, index)) {
      return null;
    }
  }
  return unescapeMarkdownSource(body);
}

function parseLinkDestinationAndTitle(value: string): {
  readonly title: string | null;
  readonly url: string;
} | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let destination: string;
  let rest: string;
  if (trimmed.startsWith("<")) {
    let close = -1;
    for (let index = 1; index < trimmed.length; index += 1) {
      if (trimmed[index] === ">" && !isEscaped(trimmed, index)) {
        close = index;
        break;
      }
    }
    if (close < 0) {
      return null;
    }
    destination = trimmed.slice(1, close);
    rest = trimmed.slice(close + 1).trim();
  } else {
    const parsed = readBalancedBareDestination(trimmed);
    if (!parsed) {
      return null;
    }
    destination = parsed.raw;
    rest = parsed.rest;
  }

  const title = rest === "" ? null : readQuotedTitle(rest);
  if (rest !== "" && title === null) {
    return null;
  }

  return {
    title,
    url: unescapeMarkdownSource(destination),
  };
}

function delimiterCandidates(spec: InlineTextFormatSpec): readonly {
  readonly close: string;
  readonly open: string;
}[] {
  if (spec.family === "bold") {
    return [
      { close: "**", open: "**" },
      { close: "__", open: "__" },
    ];
  }
  if (spec.family === "italic") {
    return [
      { close: "*", open: "*" },
      { close: "_", open: "_" },
    ];
  }
  return [{ close: spec.markdownClose, open: spec.markdownOpen }];
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) {
    return [values];
  }
  const result: T[][] = [];
  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const tail of permutations(rest)) {
      result.push([value, ...tail]);
    }
  });
  return result;
}

function expandDelimiterChains(
  specs: readonly InlineTextFormatSpec[],
): readonly {
  readonly closeLength: number;
  readonly openLength: number;
  readonly prefix: string;
  readonly suffix: string;
}[] {
  const chains: {
    readonly closeLength: number;
    readonly openLength: number;
    readonly prefix: string;
    readonly suffix: string;
  }[] = [];

  for (const orderedSpecs of permutations(specs)) {
    const appendCandidates = (
      index: number,
      chosen: readonly { readonly close: string; readonly open: string }[],
    ) => {
      if (index === orderedSpecs.length) {
        const prefix = chosen.map((candidate) => candidate.open).join("");
        const suffix = [...chosen].reverse().map((candidate) => candidate.close).join("");
        chains.push({
          closeLength: suffix.length,
          openLength: prefix.length,
          prefix,
          suffix,
        });
        return;
      }
      for (const candidate of delimiterCandidates(orderedSpecs[index])) {
        appendCandidates(index + 1, [...chosen, candidate]);
      }
    };
    appendCandidates(0, []);
  }

  return chains;
}

export function serializeInlineNodeSource(node: LexicalNode): string {
  if ($isTextNode(node)) {
    return wrapFormattedTextSource(node.getTextContent(), node);
  }
  if (
    $isFootnoteReferenceNode(node)
    || $isHeadingAttributeNode(node)
    || $isInlineImageNode(node)
    || $isInlineMathNode(node)
    || $isReferenceNode(node)
  ) {
    return node.getRaw();
  }
  if ($isLinkNode(node)) {
    return serializeMarkdownLinkSource(node);
  }
  if ($isElementNode(node)) {
    return serializeInlineChildrenSource(node);
  }
  return node.getTextContent();
}

export function findMatchingFormattedTextSource(
  markdown: string,
  node: TextNode,
  searchFrom = 0,
): MarkdownFormattedTextSourceMatch | null {
  const specs = getInlineTextFormatSpecs().filter((spec) => node.hasFormat(spec.lexicalFormat));
  if (specs.length === 0) {
    return null;
  }
  const text = node.getTextContent();
  for (const candidate of expandDelimiterChains(specs)) {
    const source = `${candidate.prefix}${text}${candidate.suffix}`;
    const from = markdown.indexOf(source, searchFrom);
    if (from >= 0) {
      return {
        closeLength: candidate.closeLength,
        from,
        openLength: candidate.openLength,
        source,
        to: from + source.length,
      };
    }
  }

  const escapedText = escapeRegExp(text);
  for (const candidate of expandDelimiterChains(specs)) {
    const pattern = new RegExp(
      `${escapeRegExp(candidate.prefix)}${escapedText}${escapeRegExp(candidate.suffix)}`,
      "g",
    );
    pattern.lastIndex = Math.max(0, searchFrom);
    const match = pattern.exec(markdown);
    if (match?.index !== undefined) {
      return {
        closeLength: candidate.closeLength,
        from: match.index,
        openLength: candidate.openLength,
        source: match[0],
        to: match.index + match[0].length,
      };
    }
  }
  return null;
}

export function serializeInlineChildrenSource(node: LexicalNode): string {
  if (!$isElementNode(node)) {
    return serializeInlineNodeSource(node);
  }
  return node.getChildren().map(serializeInlineNodeSource).join("");
}

export function serializeMarkdownLinkSource(node: LinkNode): string {
  const label = serializeInlineChildrenSource(node);
  const title = node.getTitle();
  return title
    ? `[${label}](${node.getURL()} "${escapeLinkTitle(title)}")`
    : `[${label}](${node.getURL()})`;
}

export function parseMarkdownLinkSource(raw: string): ParsedMarkdownLinkSource | null {
  if (!raw.startsWith("[") || raw.startsWith("![")) {
    return null;
  }
  const labelEnd = findLabelEnd(raw, 0);
  if (labelEnd < 0 || raw[labelEnd + 1] !== "(") {
    return null;
  }
  const linkEnd = findLinkDestinationEnd(raw, labelEnd + 1);
  if (linkEnd !== raw.length - 1) {
    return null;
  }
  const destination = parseLinkDestinationAndTitle(raw.slice(labelEnd + 2, linkEnd));
  if (!destination) {
    return null;
  }
  return {
    labelMarkdown: raw.slice(1, labelEnd),
    raw,
    title: destination.title,
    url: destination.url,
  };
}

export function parseMarkdownLinkSourceAt(
  markdown: string,
  from: number,
  to = markdown.length,
): MarkdownLinkSourceMatch | null {
  if (from < 0 || from >= to || markdown[from] !== "[" || markdown[from - 1] === "!") {
    return null;
  }
  const labelEnd = findLabelEnd(markdown, from);
  if (labelEnd < 0 || labelEnd >= to || markdown[labelEnd + 1] !== "(") {
    return null;
  }
  const linkEnd = findLinkDestinationEnd(markdown, labelEnd + 1);
  if (linkEnd < 0 || linkEnd >= to) {
    return null;
  }
  const parsed = parseMarkdownLinkSource(markdown.slice(from, linkEnd + 1));
  return parsed
    ? {
        ...parsed,
        from,
        to: linkEnd + 1,
      }
    : null;
}

function linkNodeMatchesParsedSource(node: LinkNode, parsed: ParsedMarkdownLinkSource): boolean {
  const serializedLabel = serializeInlineChildrenSource(node);
  return (
    (serializedLabel === parsed.labelMarkdown || node.getTextContent() === markdownLabelVisibleText(parsed.labelMarkdown))
    && node.getURL() === parsed.url
    && (node.getTitle() ?? null) === parsed.title
  );
}

export function findMatchingMarkdownLinkSource(
  markdown: string,
  node: LinkNode,
  searchFrom = 0,
): MarkdownLinkSourceMatch | null {
  let cursor = Math.max(0, searchFrom);
  while (cursor < markdown.length) {
    const labelStart = markdown.indexOf("[", cursor);
    if (labelStart < 0) {
      return null;
    }
    if (labelStart > 0 && markdown[labelStart - 1] === "!") {
      cursor = labelStart + 1;
      continue;
    }
    const parsed = parseMarkdownLinkSourceAt(markdown, labelStart);
    if (parsed && linkNodeMatchesParsedSource(node, parsed)) {
      return parsed;
    }
    cursor = parsed?.to ?? labelStart + 1;
  }
  return null;
}
