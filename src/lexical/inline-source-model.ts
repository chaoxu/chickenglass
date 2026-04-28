import {
  findNextInlineMathSource,
  type InlineMathDelimiter,
} from "../lib/inline-math-source";
import { MARKDOWN_IMAGE_IMPORT_RE } from "../lib/markdown-image";
import {
  scanReferenceRevealTokens,
  type ReferenceRevealToken,
} from "../lib/reference-tokens";
import { parseMarkdownLinkSourceAt } from "./markdown/inline-source";

export type InlineSourceSpanKind =
  | "footnote-reference"
  | "inline-image"
  | "inline-math"
  | "link"
  | "reference";

interface InlineSourceSpanBase {
  readonly from: number;
  readonly kind: InlineSourceSpanKind;
  readonly source: string;
  readonly to: number;
}

export interface InlineMathSourceSpan extends InlineSourceSpanBase {
  readonly body: string;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly delimiter: InlineMathDelimiter;
  readonly kind: "inline-math";
}

export interface InlineImageSourceSpan extends InlineSourceSpanBase {
  readonly kind: "inline-image";
}

export interface LinkSourceSpan extends InlineSourceSpanBase {
  readonly kind: "link";
  readonly labelFrom: number;
  readonly labelMarkdown: string;
  readonly title: string | null;
  readonly url: string;
}

export interface FootnoteReferenceSourceSpan extends InlineSourceSpanBase {
  readonly kind: "footnote-reference";
}

export interface ReferenceSourceSpan extends InlineSourceSpanBase {
  readonly bracketed: boolean;
  readonly kind: "reference";
}

export type InlineSourceSpan =
  | FootnoteReferenceSourceSpan
  | InlineImageSourceSpan
  | InlineMathSourceSpan
  | LinkSourceSpan
  | ReferenceSourceSpan;

function anchoredMatch(
  regex: RegExp,
  source: string,
  from: number,
  to: number,
): RegExpMatchArray | null {
  const match = source.slice(from, to).match(regex);
  return match?.index === 0 ? match : null;
}

function parseInlineMathAt(
  source: string,
  from: number,
  to: number,
): InlineMathSourceSpan | null {
  const parsed = findNextInlineMathSource(source.slice(from, to), 0, {
    requireTightDollar: true,
  });
  return parsed?.from === 0
    ? {
        body: parsed.body,
        bodyFrom: from + parsed.bodyFrom,
        bodyTo: from + parsed.bodyTo,
        delimiter: parsed.delimiter,
        from,
        kind: "inline-math",
        source: parsed.raw,
        to: from + parsed.raw.length,
      }
    : null;
}

function parseInlineImageAt(
  source: string,
  from: number,
  to: number,
): InlineImageSourceSpan | null {
  const match = anchoredMatch(MARKDOWN_IMAGE_IMPORT_RE, source, from, to);
  return match
    ? {
        from,
        kind: "inline-image",
        source: match[0],
        to: from + match[0].length,
      }
    : null;
}

function parseLinkAt(source: string, from: number, to: number): LinkSourceSpan | null {
  const parsed = parseMarkdownLinkSourceAt(source, from, to);
  return parsed
    ? {
        from,
        kind: "link",
        labelFrom: from + 1,
        labelMarkdown: parsed.labelMarkdown,
        source: parsed.raw,
        title: parsed.title,
        to: parsed.to,
        url: parsed.url,
      }
    : null;
}

function parseFootnoteReferenceAt(
  source: string,
  from: number,
  to: number,
): FootnoteReferenceSourceSpan | null {
  const match = anchoredMatch(/^\[\^[^\]\n]+\]/, source, from, to);
  return match
    ? {
        from,
        kind: "footnote-reference",
        source: match[0],
        to: from + match[0].length,
      }
    : null;
}

function parseReferenceAt(
  from: number,
  to: number,
  referenceRevealsByFrom: ReadonlyMap<number, ReferenceRevealToken>,
): ReferenceSourceSpan | null {
  const reveal = referenceRevealsByFrom.get(from);
  if (!reveal || reveal.to > to) {
    return null;
  }
  return {
    bracketed: reveal.bracketed,
    from,
    kind: "reference",
    source: reveal.source,
    to: reveal.to,
  };
}

function referenceRevealMap(source: string): ReadonlyMap<number, ReferenceRevealToken> {
  return new Map(
    scanReferenceRevealTokens(source).map((reveal) => [reveal.from, reveal] as const),
  );
}

function parseInlineSourceSpanAt(
  source: string,
  from: number,
  to: number,
  referenceRevealsByFrom: ReadonlyMap<number, ReferenceRevealToken>,
): InlineSourceSpan | null {
  return parseInlineMathAt(source, from, to)
    ?? parseInlineImageAt(source, from, to)
    ?? parseLinkAt(source, from, to)
    ?? parseFootnoteReferenceAt(source, from, to)
    ?? parseReferenceAt(from, to, referenceRevealsByFrom);
}

export function parseInlineSourceAt(
  source: string,
  from: number,
  to = source.length,
): InlineSourceSpan | null {
  return parseInlineSourceSpanAt(source, from, to, referenceRevealMap(source));
}

export function parseInlineSource(source: string): readonly InlineSourceSpan[] {
  const spans: InlineSourceSpan[] = [];
  const referenceRevealsByFrom = referenceRevealMap(source);
  let cursor = 0;
  while (cursor < source.length) {
    const span = parseInlineSourceSpanAt(
      source,
      cursor,
      source.length,
      referenceRevealsByFrom,
    );
    if (span) {
      spans.push(span);
      cursor = span.to;
      continue;
    }
    cursor += 1;
  }
  return spans;
}

export function parseInlineSourceExact(source: string): InlineSourceSpan | null {
  const span = parseInlineSourceAt(source, 0);
  return span?.to === source.length ? span : null;
}
