import { $isLinkNode, type LinkNode } from "@lexical/link";
import { $isElementNode, $isTextNode, type LexicalNode, type TextNode } from "lexical";

import { getInlineTextFormatSpecs } from "../../lexical-next";
import type { InlineTextFormatSpec } from "../../lexical-next";
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

const LINK_SOURCE_RE = /\[([^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\]\(([^()\s]+)(?:\s"((?:[^"\\]|\\.)*)"\s*)?\)/g;
const LINK_SOURCE_ANCHORED_RE = new RegExp(`^(?:${LINK_SOURCE_RE.source})$`);
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
  if (specs.length !== 1) {
    return null;
  }
  const [spec] = specs;
  const text = node.getTextContent();
  for (const candidate of delimiterCandidates(spec)) {
    const source = `${candidate.open}${text}${candidate.close}`;
    const from = markdown.indexOf(source, searchFrom);
    if (from >= 0) {
      return {
        closeLength: candidate.close.length,
        from,
        openLength: candidate.open.length,
        source,
        to: from + source.length,
      };
    }
  }

  const escapedText = escapeRegExp(text);
  for (const candidate of delimiterCandidates(spec)) {
    const pattern = new RegExp(
      `${escapeRegExp(candidate.open)}${escapedText}${escapeRegExp(candidate.close)}`,
      "g",
    );
    pattern.lastIndex = Math.max(0, searchFrom);
    const match = pattern.exec(markdown);
    if (match?.index !== undefined) {
      return {
        closeLength: candidate.close.length,
        from: match.index,
        openLength: candidate.open.length,
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
  const match = raw.match(LINK_SOURCE_ANCHORED_RE);
  if (!match) {
    return null;
  }
  return {
    labelMarkdown: match[1],
    raw,
    title: match[3] === undefined ? null : unescapeMarkdownSource(match[3]),
    url: unescapeMarkdownSource(match[2]),
  };
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
  LINK_SOURCE_RE.lastIndex = Math.max(0, searchFrom);
  let match: RegExpExecArray | null;
  while ((match = LINK_SOURCE_RE.exec(markdown)) !== null) {
    const raw = match[0];
    const parsed = parseMarkdownLinkSource(raw);
    if (parsed && linkNodeMatchesParsedSource(node, parsed)) {
      return {
        ...parsed,
        from: match.index,
        to: match.index + raw.length,
      };
    }
  }
  return null;
}
