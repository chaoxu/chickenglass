import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { markdownExtensions } from "./parser";
import { MARK_NODES } from "./render/inline-shared";
import { extractReferenceCluster } from "./semantics/reference-parts";

const inlineParser = baseParser.configure(markdownExtensions);

export type InlineFragment =
  | { kind: "text"; text: string }
  | { kind: "emphasis"; children: readonly InlineFragment[] }
  | { kind: "strong"; children: readonly InlineFragment[] }
  | { kind: "strikethrough"; children: readonly InlineFragment[] }
  | { kind: "highlight"; children: readonly InlineFragment[] }
  | { kind: "code"; text: string }
  | { kind: "math"; latex: string; raw: string }
  | { kind: "link"; href?: string; children: readonly InlineFragment[] }
  | {
      kind: "reference";
      rawText: string;
      ids: readonly string[];
      locators: readonly (string | undefined)[];
    }
  | {
      kind: "image";
      rawAlt: string;
      alt: readonly InlineFragment[];
      src?: string;
    }
  | { kind: "footnote-ref"; id: string }
  | { kind: "hard-break" };

function createTextFragment(text: string): InlineFragment | null {
  return text ? { kind: "text", text } : null;
}

function getCodeText(node: SyntaxNode, doc: string): string {
  const marks = node.getChildren("CodeMark");
  if (marks.length >= 2) {
    return doc.slice(marks[0].to, marks[marks.length - 1].from);
  }
  return doc.slice(node.from, node.to);
}

function getInlineMath(node: SyntaxNode, doc: string): { latex: string; raw: string } {
  const raw = doc.slice(node.from, node.to);
  const marks = node.getChildren("InlineMathMark");
  if (marks.length >= 2) {
    return {
      latex: doc.slice(marks[0].to, marks[marks.length - 1].from),
      raw,
    };
  }
  return { latex: raw, raw };
}

function getDelimitedRange(
  node: SyntaxNode,
  markName: string,
): { from: number; to: number } | null {
  const marks = node.getChildren(markName);
  if (marks.length < 2) return null;
  const from = marks[0].to;
  const to = marks[1].from;
  return to >= from ? { from, to } : null;
}

function buildLinkChildren(node: SyntaxNode, doc: string): readonly InlineFragment[] {
  const range = getDelimitedRange(node, "LinkMark");
  if (!range) {
    return [createTextFragment(doc.slice(node.from, node.to))].filter(Boolean) as InlineFragment[];
  }
  return buildInlineFragments(node, doc, range.from, range.to);
}

function buildLinkFragment(node: SyntaxNode, doc: string): InlineFragment {
  const raw = doc.slice(node.from, node.to);
  const crossRefMatch = /^\[@([^\]]+)\]$/.exec(raw);
  if (crossRefMatch) {
    const { ids, locators } = extractReferenceCluster(crossRefMatch[1]);
    return {
      kind: "reference",
      rawText: raw.slice(1, -1),
      ids,
      locators,
    };
  }

  const hrefNode = node.getChild("URL");
  const href = hrefNode ? doc.slice(hrefNode.from, hrefNode.to).trim() : undefined;
  return {
    kind: "link",
    href,
    children: buildLinkChildren(node, doc),
  };
}

function buildImageFragment(node: SyntaxNode, doc: string): InlineFragment {
  const range = getDelimitedRange(node, "LinkMark");
  const rawAlt = range ? doc.slice(range.from, range.to) : "";
  const alt = range ? buildInlineFragments(node, doc, range.from, range.to) : [];
  const srcNode = node.getChild("URL");
  const src = srcNode ? doc.slice(srcNode.from, srcNode.to).trim() : undefined;
  return {
    kind: "image",
    rawAlt,
    alt,
    src,
  };
}

function buildFootnoteFragment(node: SyntaxNode, doc: string): InlineFragment {
  const raw = doc.slice(node.from, node.to);
  const match = /^\[\^([^\]]+)\]$/.exec(raw);
  return {
    kind: "footnote-ref",
    id: match?.[1] ?? raw,
  };
}

function buildInlineFragment(node: SyntaxNode, doc: string): InlineFragment[] {
  if (MARK_NODES.has(node.name) || node.name === "URL") {
    return [];
  }

  switch (node.name) {
    case "Emphasis":
      return [{ kind: "emphasis", children: buildInlineFragments(node, doc) }];
    case "StrongEmphasis":
      return [{ kind: "strong", children: buildInlineFragments(node, doc) }];
    case "Strikethrough":
      return [{ kind: "strikethrough", children: buildInlineFragments(node, doc) }];
    case "Highlight":
      return [{ kind: "highlight", children: buildInlineFragments(node, doc) }];
    case "InlineCode":
      return [{ kind: "code", text: getCodeText(node, doc) }];
    case "InlineMath": {
      const { latex, raw } = getInlineMath(node, doc);
      return [{ kind: "math", latex, raw }];
    }
    case "Link":
      return [buildLinkFragment(node, doc)];
    case "Image":
      return [buildImageFragment(node, doc)];
    case "FootnoteRef":
      return [buildFootnoteFragment(node, doc)];
    case "Escape": {
      const text = createTextFragment(doc.slice(node.from + 1, node.to));
      return text ? [text] : [];
    }
    case "HardBreak":
      return [{ kind: "hard-break" }];
    default: {
      const text = createTextFragment(doc.slice(node.from, node.to));
      return text ? [text] : [];
    }
  }
}

export function buildInlineFragments(
  node: SyntaxNode,
  doc: string,
  rangeFrom?: number,
  rangeTo?: number,
): InlineFragment[] {
  const from = rangeFrom ?? node.from;
  const to = rangeTo ?? node.to;
  const fragments: InlineFragment[] = [];
  let pos = from;
  let child = node.firstChild;

  while (child) {
    if (child.to > from && child.from < to) {
      if (child.from > pos) {
        const text = createTextFragment(doc.slice(pos, child.from));
        if (text) fragments.push(text);
      }
      fragments.push(...buildInlineFragment(child, doc));
      pos = child.to;
    }
    child = child.nextSibling;
  }

  if (pos < to) {
    const text = createTextFragment(doc.slice(pos, to));
    if (text) fragments.push(text);
  }

  return fragments;
}

export function parseInlineFragments(text: string): InlineFragment[] {
  if (!text) return [];

  const tree = inlineParser.parse(text);
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) {
    return [{ kind: "text", text }];
  }

  const fragments: InlineFragment[] = [];
  if (para.from > 0) {
    fragments.push({ kind: "text", text: text.slice(0, para.from) });
  }
  fragments.push(...buildInlineFragments(para, text));
  if (para.to < text.length) {
    fragments.push({ kind: "text", text: text.slice(para.to) });
  }
  return fragments;
}
