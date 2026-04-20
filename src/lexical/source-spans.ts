import { $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
  type TextNode,
} from "lexical";

import { getInlineTextFormatSpecs } from "../lexical-next";
import { findMatchingFormattedTextSource, findMatchingMarkdownLinkSource, serializeMarkdownLinkSource } from "./markdown/inline-source";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isHeadingAttributeNode } from "./nodes/heading-attribute-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { isRevealSourceStyle } from "./reveal-source-style";

export type SourceRevealAdapterId =
  | "footnote-reference"
  | "heading-attribute"
  | "inline-image"
  | "inline-math"
  | "link"
  | "raw-block"
  | "reference"
  | "text-format";

interface SourceRange {
  readonly from: number;
  readonly to: number;
}

interface SourceSpanBase extends SourceRange {
  readonly node: LexicalNode;
  readonly source: string;
}

export interface SourceTextSpan extends SourceSpanBase {
  readonly kind: "text";
  readonly node: TextNode;
}

export interface SourceRevealSpan extends SourceSpanBase {
  readonly adapterId: SourceRevealAdapterId;
  readonly kind: "reveal";
}

export type SourceSpan = SourceTextSpan | SourceRevealSpan;

export type SourceLocation =
  | {
      readonly kind: "text";
      readonly node: TextNode;
      readonly offset: number;
      readonly span: SourceTextSpan;
    }
  | {
      readonly adapterId: SourceRevealAdapterId;
      readonly kind: "reveal";
      readonly node: LexicalNode;
      readonly offset: number;
      readonly source: string;
      readonly span: SourceRevealSpan;
    };

export interface FormattedTextSource {
  readonly closeLength: number;
  readonly openLength: number;
  readonly source: string;
}

interface CollectContext {
  readonly baseOffset: number;
  readonly markdown: string;
  searchFrom: number;
}

interface CollectResult {
  readonly range: SourceRange | null;
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(offset, length));
}

function unionRange(a: SourceRange | null, b: SourceRange | null): SourceRange | null {
  if (!a) return b;
  if (!b) return a;
  return {
    from: Math.min(a.from, b.from),
    to: Math.max(a.to, b.to),
  };
}

function findLiteralSource(
  context: CollectContext,
  source: string,
): SourceRange | null {
  if (source.length === 0) {
    return null;
  }
  const from = context.markdown.indexOf(source, context.searchFrom);
  if (from < 0) {
    return null;
  }
  return {
    from: context.baseOffset + from,
    to: context.baseOffset + from + source.length,
  };
}

export function getFormattedTextSourceForNode(node: TextNode): FormattedTextSource | null {
  const specs = getInlineTextFormatSpecs().filter((spec) => node.hasFormat(spec.lexicalFormat));
  if (specs.length === 0) {
    return null;
  }
  const open = specs.map((spec) => spec.markdownOpen).join("");
  const close = [...specs].reverse().map((spec) => spec.markdownClose).join("");
  return {
    closeLength: close.length,
    openLength: open.length,
    source: `${open}${node.getTextContent()}${close}`,
  };
}

function revealSourceForNode(
  node: LexicalNode,
): { readonly adapterId: SourceRevealAdapterId; readonly source: string } | null {
  if ($isInlineMathNode(node)) {
    return { adapterId: "inline-math", source: node.getRaw() };
  }
  if ($isInlineImageNode(node)) {
    return { adapterId: "inline-image", source: node.getRaw() };
  }
  if ($isReferenceNode(node)) {
    return { adapterId: "reference", source: node.getRaw() };
  }
  if ($isFootnoteReferenceNode(node)) {
    return { adapterId: "footnote-reference", source: node.getRaw() };
  }
  if ($isHeadingAttributeNode(node)) {
    return { adapterId: "heading-attribute", source: node.getRaw() };
  }
  if ($isRawBlockNode(node)) {
    return { adapterId: "raw-block", source: node.getRaw() };
  }
  return null;
}

function addRevealSpan(
  spans: SourceSpan[],
  node: LexicalNode,
  range: SourceRange,
  adapterId: SourceRevealAdapterId,
  source: string,
): SourceRevealSpan {
  const span: SourceRevealSpan = {
    adapterId,
    from: range.from,
    kind: "reveal",
    node,
    source,
    to: range.to,
  };
  spans.push(span);
  return span;
}

function addTextSpan(
  spans: SourceSpan[],
  node: TextNode,
  range: SourceRange,
  source: string,
): SourceTextSpan {
  const span: SourceTextSpan = {
    from: range.from,
    kind: "text",
    node,
    source,
    to: range.to,
  };
  spans.push(span);
  return span;
}

function collectTextNodeSpans(
  node: TextNode,
  context: CollectContext,
  spans: SourceSpan[],
): CollectResult {
  const formatted = getFormattedTextSourceForNode(node);
  if (formatted) {
    const match = findMatchingFormattedTextSource(context.markdown, node, context.searchFrom);
    const source = match?.source ?? formatted.source;
    const range = match
      ? {
          from: context.baseOffset + match.from,
          to: context.baseOffset + match.to,
        }
      : findLiteralSource(context, source);
    if (!range) {
      return { range: null };
    }

    const openLength = match?.openLength ?? formatted.openLength;
    const closeLength = match?.closeLength ?? formatted.closeLength;
    addRevealSpan(spans, node, range, "text-format", source);
    addTextSpan(spans, node, {
      from: range.from + openLength,
      to: range.to - closeLength,
    }, node.getTextContent());
    context.searchFrom = range.to - context.baseOffset;
    return { range };
  }

  const source = node.getTextContent();
  const range = findLiteralSource(context, source);
  if (!range) {
    return { range: null };
  }
  addTextSpan(spans, node, range, source);
  context.searchFrom = range.to - context.baseOffset;
  return { range };
}

function collectLinkSpans(
  node: LinkNode,
  context: CollectContext,
  spans: SourceSpan[],
  nodeRanges: Map<string, SourceRange>,
): CollectResult {
  const match = findMatchingMarkdownLinkSource(context.markdown, node, context.searchFrom);
  const source = match?.raw ?? serializeMarkdownLinkSource(node);
  const range = match
    ? {
        from: context.baseOffset + match.from,
        to: context.baseOffset + match.to,
      }
    : findLiteralSource(context, source);
  if (!range) {
    return { range: null };
  }

  addRevealSpan(spans, node, range, "link", source);
  nodeRanges.set(node.getKey(), range);

  if (match) {
    const labelContext: CollectContext = {
      baseOffset: range.from + 1,
      markdown: match.labelMarkdown,
      searchFrom: 0,
    };
    let childRange: SourceRange | null = null;
    for (const child of node.getChildren()) {
      const result = collectNodeSpans(child, labelContext, spans, nodeRanges);
      childRange = unionRange(childRange, result.range);
    }
    nodeRanges.set(node.getKey(), unionRange(range, childRange) ?? range);
  }

  context.searchFrom = range.to - context.baseOffset;
  return { range };
}

function collectRevealNodeSpans(
  node: LexicalNode,
  context: CollectContext,
  spans: SourceSpan[],
): CollectResult {
  const reveal = revealSourceForNode(node);
  if (!reveal) {
    return { range: null };
  }
  const range = findLiteralSource(context, reveal.source);
  if (!range) {
    return { range: null };
  }
  addRevealSpan(spans, node, range, reveal.adapterId, reveal.source);
  context.searchFrom = range.to - context.baseOffset;
  return { range };
}

function collectElementSpans(
  node: LexicalNode,
  context: CollectContext,
  spans: SourceSpan[],
  nodeRanges: Map<string, SourceRange>,
): CollectResult {
  if (!$isElementNode(node)) {
    return { range: null };
  }

  let range: SourceRange | null = null;
  for (const child of node.getChildren()) {
    const childResult = collectNodeSpans(child, context, spans, nodeRanges);
    range = unionRange(range, childResult.range);
  }
  if (range) {
    nodeRanges.set(node.getKey(), range);
  }
  return { range };
}

function collectNodeSpans(
  node: LexicalNode,
  context: CollectContext,
  spans: SourceSpan[],
  nodeRanges: Map<string, SourceRange>,
): CollectResult {
  if ($isLinkNode(node)) {
    return collectLinkSpans(node, context, spans, nodeRanges);
  }
  if ($isTextNode(node)) {
    const result = collectTextNodeSpans(node, context, spans);
    if (result.range) {
      nodeRanges.set(node.getKey(), result.range);
    }
    return result;
  }

  const revealResult = collectRevealNodeSpans(node, context, spans);
  if (revealResult.range) {
    nodeRanges.set(node.getKey(), revealResult.range);
    return revealResult;
  }

  return collectElementSpans(node, context, spans, nodeRanges);
}

function sourceLocationFromSpan(span: SourceSpan, offset: number): SourceLocation {
  const sourceOffset = clampOffset(offset - span.from, span.source.length);
  if (span.kind === "text") {
    return {
      kind: "text",
      node: span.node,
      offset: clampOffset(sourceOffset, span.node.getTextContentSize()),
      span,
    };
  }
  return {
    adapterId: span.adapterId,
    kind: "reveal",
    node: span.node,
    offset: sourceOffset,
    source: span.source,
    span,
  };
}

function sourceSpanPriority(span: SourceSpan): number {
  return span.kind === "text" ? 0 : 1;
}

function closingDelimiterLength(source: string): number {
  if (source.endsWith("\\)")) {
    return 2;
  }
  if (
    source.endsWith("$")
    || source.endsWith("]")
    || source.endsWith(")")
    || source.endsWith("*")
    || source.endsWith("_")
    || source.endsWith("`")
  ) {
    return 1;
  }
  return 0;
}

function clampRevealSourceTextOffset(node: TextNode, offset: number): number {
  const source = node.getTextContent();
  const safeOffset = clampOffset(offset, node.getTextContentSize());
  if (!isRevealSourceStyle(node.getStyle()) || safeOffset !== source.length) {
    return safeOffset;
  }
  const closeLength = closingDelimiterLength(source);
  return closeLength > 0
    ? Math.max(0, source.length - closeLength)
    : safeOffset;
}

export class SourceSpanIndex {
  readonly spans: readonly SourceSpan[];
  private readonly nodeRanges: ReadonlyMap<string, SourceRange>;
  private readonly spansByNodeKey: ReadonlyMap<string, readonly SourceSpan[]>;

  constructor(
    spans: readonly SourceSpan[],
    nodeRanges: ReadonlyMap<string, SourceRange>,
  ) {
    this.spans = [...spans].sort((a, b) => (
      a.from - b.from
      || sourceSpanPriority(a) - sourceSpanPriority(b)
      || (a.to - a.from) - (b.to - b.from)
    ));
    this.nodeRanges = nodeRanges;
    const byNode = new Map<string, SourceSpan[]>();
    for (const span of this.spans) {
      const key = span.node.getKey();
      const bucket = byNode.get(key);
      if (bucket) {
        bucket.push(span);
      } else {
        byNode.set(key, [span]);
      }
    }
    this.spansByNodeKey = byNode;
  }

  findNearestLocation(offset: number): SourceLocation | null {
    const target = Math.max(0, offset);
    const starting = this.spans.filter((span) => span.from === target);
    if (starting.length > 0) {
      const [best] = starting.sort((a, b) => (
        sourceSpanPriority(a) - sourceSpanPriority(b)
        || (a.to - a.from) - (b.to - b.from)
      ));
      return sourceLocationFromSpan(best, target);
    }

    const containing = this.spans.filter((span) => span.from <= target && target <= span.to);
    if (containing.length > 0) {
      const [best] = containing.sort((a, b) => (
        sourceSpanPriority(a) - sourceSpanPriority(b)
        || (a.to - a.from) - (b.to - b.from)
      ));
      return sourceLocationFromSpan(best, target);
    }

    const next = this.spans.find((span) => target <= span.from) ?? null;
    if (next) {
      return sourceLocationFromSpan(next, next.from);
    }

    const previous = [...this.spans].reverse().find((span) => span.to <= target) ?? null;
    return previous ? sourceLocationFromSpan(previous, previous.to) : null;
  }

  getNodeStart(node: LexicalNode): number | null {
    return this.nodeRanges.get(node.getKey())?.from ?? null;
  }

  getNodeEnd(node: LexicalNode): number | null {
    return this.nodeRanges.get(node.getKey())?.to ?? null;
  }

  getRevealNodeEditableEnd(node: LexicalNode): number | null {
    const spans = this.spansByNodeKey.get(node.getKey()) ?? [];
    const revealSpan = spans.find((span): span is SourceRevealSpan => span.kind === "reveal");
    if (!revealSpan) {
      return null;
    }
    const closeLength = closingDelimiterLength(revealSpan.source);
    return closeLength > 0 ? revealSpan.to - closeLength : revealSpan.to;
  }

  getTextNodeOffset(node: TextNode, offset: number): number | null {
    const spans = this.spansByNodeKey.get(node.getKey()) ?? [];
    const textSpan = spans.find((span): span is SourceTextSpan => span.kind === "text");
    if (!textSpan) {
      return null;
    }
    return textSpan.from + clampRevealSourceTextOffset(node, offset);
  }
}

export function createSourceSpanIndex(markdown: string): SourceSpanIndex {
  const spans: SourceSpan[] = [];
  const nodeRanges = new Map<string, SourceRange>();
  collectNodeSpans($getRoot(), {
    baseOffset: 0,
    markdown,
    searchFrom: 0,
  }, spans, nodeRanges);
  return new SourceSpanIndex(spans, nodeRanges);
}
