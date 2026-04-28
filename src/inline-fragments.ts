import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { markdownExtensions } from "./parser";
import { MARK_NODES } from "./render/render-core";
import {
  matchBracketedReference,
  NARRATIVE_REFERENCE_RE,
} from "./semantics/reference-parts";

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
      parenthetical: boolean;
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

function buildLinkChildren(
  node: SyntaxNode,
  doc: string,
): readonly InlineFragment[] {
  const range = getDelimitedRange(node, "LinkMark");
  if (!range) {
    return [createTextFragment(doc.slice(node.from, node.to))].filter(Boolean) as InlineFragment[];
  }
  return buildInlineFragmentsRaw(node, doc, range.from, range.to);
}

function buildLinkFragment(
  node: SyntaxNode,
  doc: string,
): InlineFragment[] {
  const raw = doc.slice(node.from, node.to);
  const referenceMatch = matchBracketedReference(raw);
  if (referenceMatch) {
    return [{
      kind: "reference",
      parenthetical: true,
      rawText: referenceMatch.raw,
      ids: referenceMatch.ids,
      locators: referenceMatch.locators,
    }];
  }

  const hrefNode = node.getChild("URL");
  if (!hrefNode) {
    const text = createTextFragment(raw);
    return text ? [text] : [];
  }
  return [{
    kind: "link",
    href: doc.slice(hrefNode.from, hrefNode.to).trim(),
    children: buildLinkChildren(node, doc),
  }];
}

function buildImageFragment(
  node: SyntaxNode,
  doc: string,
): InlineFragment {
  const range = getDelimitedRange(node, "LinkMark");
  const rawAlt = range ? doc.slice(range.from, range.to) : "";
  const alt = range ? buildInlineFragmentsRaw(node, doc, range.from, range.to) : [];
  const srcNode = node.getChild("URL");
  const src = srcNode ? doc.slice(srcNode.from, srcNode.to).trim() : undefined;
  return {
    kind: "image",
    rawAlt,
    alt,
    src,
  };
}

function buildAutolinkFragment(node: SyntaxNode, doc: string): InlineFragment[] {
  const urlNode = node.getChild("URL");
  if (!urlNode) {
    const text = createTextFragment(doc.slice(node.from, node.to));
    return text ? [text] : [];
  }
  const href = doc.slice(urlNode.from, urlNode.to);
  return [{ kind: "link", href, children: [{ kind: "text", text: href }] }];
}

function buildFootnoteFragment(node: SyntaxNode, doc: string): InlineFragment {
  const raw = doc.slice(node.from, node.to);
  const match = /^\[\^([^\]]+)\]$/.exec(raw);
  return {
    kind: "footnote-ref",
    id: match?.[1] ?? raw,
  };
}

function buildInlineFragment(
  node: SyntaxNode,
  doc: string,
): InlineFragment[] {
  if (MARK_NODES.has(node.name)) {
    return [];
  }

  switch (node.name) {
    case "Emphasis":
      return [{ kind: "emphasis", children: buildInlineFragmentsRaw(node, doc) }];
    case "StrongEmphasis":
      return [{ kind: "strong", children: buildInlineFragmentsRaw(node, doc) }];
    case "Strikethrough":
      return [{ kind: "strikethrough", children: buildInlineFragmentsRaw(node, doc) }];
    case "Highlight":
      return [{ kind: "highlight", children: buildInlineFragmentsRaw(node, doc) }];
    case "InlineCode":
      return [{ kind: "code", text: getCodeText(node, doc) }];
    case "InlineMath": {
      const { latex, raw } = getInlineMath(node, doc);
      return [{ kind: "math", latex, raw }];
    }
    case "Link":
      return buildLinkFragment(node, doc);
    case "Autolink":
      return buildAutolinkFragment(node, doc);
    case "URL": {
      if (node.parent?.name !== "Autolink") {
        const text = createTextFragment(doc.slice(node.from, node.to));
        return text ? [text] : [];
      }
      const href = doc.slice(node.from, node.to);
      return [{ kind: "link", href, children: [{ kind: "text", text: href }] }];
    }
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

function splitNarrativeReferenceText(text: string): InlineFragment[] {
  if (!text) return [];

  const fragments: InlineFragment[] = [];
  let pos = 0;

  NARRATIVE_REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NARRATIVE_REFERENCE_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (from > pos) {
      fragments.push({ kind: "text", text: text.slice(pos, from) });
    }
    fragments.push({
      kind: "reference",
      parenthetical: false,
      rawText: match[0],
      ids: [match[1]],
      locators: [undefined],
    });
    pos = to;
  }

  if (pos < text.length) {
    fragments.push({ kind: "text", text: text.slice(pos) });
  }

  return fragments.length > 0 ? fragments : [{ kind: "text", text }];
}

function normalizeNarrativeReferences(
  fragments: readonly InlineFragment[],
): InlineFragment[] {
  const normalized: InlineFragment[] = [];

  for (const fragment of fragments) {
    switch (fragment.kind) {
      case "text":
        normalized.push(...splitNarrativeReferenceText(fragment.text));
        break;

      case "emphasis":
      case "strong":
      case "strikethrough":
      case "highlight":
        normalized.push({
          ...fragment,
          children: normalizeNarrativeReferences(fragment.children),
        });
        break;

      default:
        normalized.push(fragment);
        break;
    }
  }

  return normalized;
}

function buildInlineFragmentsRaw(
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

function mergeAdjacentTextFragments(
  fragments: readonly InlineFragment[],
): InlineFragment[] {
  const merged: InlineFragment[] = [];
  for (const fragment of fragments) {
    const previous = merged.at(-1);
    if (previous?.kind === "text" && fragment.kind === "text") {
      merged[merged.length - 1] = {
        kind: "text",
        text: previous.text + fragment.text,
      };
      continue;
    }
    merged.push(fragment);
  }
  return merged;
}

export function buildInlineFragments(
  node: SyntaxNode,
  doc: string,
  rangeFrom?: number,
  rangeTo?: number,
): InlineFragment[] {
  return normalizeNarrativeReferences(
    mergeAdjacentTextFragments(buildInlineFragmentsRaw(
      node,
      doc,
      rangeFrom,
      rangeTo,
    )),
  );
}

export function parseInlineFragments(text: string): InlineFragment[] {
  if (!text) return [];

  const tree = inlineParser.parse(text);
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) {
    return normalizeNarrativeReferences([{ kind: "text", text }]);
  }

  const fragments: InlineFragment[] = [];
  if (para.from > 0) {
    fragments.push({ kind: "text", text: text.slice(0, para.from) });
  }
  fragments.push(...buildInlineFragmentsRaw(para, text));
  if (para.to < text.length) {
    fragments.push({ kind: "text", text: text.slice(para.to) });
  }
  return normalizeNarrativeReferences(mergeAdjacentTextFragments(fragments));
}

function findNeutralGapAnchor(
  docText: string,
  from: number,
  to: number,
): number | null {
  if (to - from < 2) return null;

  for (let pos = from + 1; pos < to; pos++) {
    if (!/\s/.test(docText[pos] ?? "")) {
      return pos;
    }
  }

  return from + 1 < to ? from + 1 : null;
}

export function findInlineNeutralAnchor(text: string): number | null {
  if (!text) return null;

  const tree = inlineParser.parse(text);
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) return null;

  let pos = para.from;
  let child = para.firstChild;

  while (child) {
    if (child.from > pos) {
      const anchor = findNeutralGapAnchor(text, pos, child.from);
      if (anchor !== null) return anchor;
    }
    pos = child.to;
    child = child.nextSibling;
  }

  if (pos < para.to) {
    return findNeutralGapAnchor(text, pos, para.to);
  }

  return null;
}
