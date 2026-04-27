import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { markdownExtensions } from "./parser";
import { MARK_NODES } from "./render/render-core";
import {
  matchBracketedReference,
  NARRATIVE_REFERENCE_RE,
} from "./semantics/reference-parts";
import {
  collectLinkReferencesFromTree,
  resolveLinkReference,
  type LinkReferenceMap,
} from "./lib/markdown/link-references";

const inlineParser = baseParser.configure(markdownExtensions);

export type InlineFragment =
  | { kind: "text"; text: string }
  | { kind: "emphasis"; children: readonly InlineFragment[] }
  | { kind: "strong"; children: readonly InlineFragment[] }
  | { kind: "strikethrough"; children: readonly InlineFragment[] }
  | { kind: "highlight"; children: readonly InlineFragment[] }
  | { kind: "code"; text: string }
  | { kind: "html-element"; tagName: "sub" | "sup"; children: readonly InlineFragment[] }
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
  linkReferences?: LinkReferenceMap,
): readonly InlineFragment[] {
  const range = getDelimitedRange(node, "LinkMark");
  if (!range) {
    return [createTextFragment(doc.slice(node.from, node.to))].filter(Boolean) as InlineFragment[];
  }
  return buildInlineFragmentsRaw(node, doc, range.from, range.to, linkReferences);
}

function buildLinkFragment(
  node: SyntaxNode,
  doc: string,
  linkReferences?: LinkReferenceMap,
): InlineFragment {
  const raw = doc.slice(node.from, node.to);
  const referenceMatch = matchBracketedReference(raw);
  if (referenceMatch) {
    return {
      kind: "reference",
      parenthetical: true,
      rawText: referenceMatch.raw,
      ids: referenceMatch.ids,
      locators: referenceMatch.locators,
    };
  }

  const hrefNode = node.getChild("URL");
  const labelNode = node.getChild("LinkLabel");
  const href = hrefNode
    ? doc.slice(hrefNode.from, hrefNode.to).trim()
    : labelNode && linkReferences
      ? resolveLinkReference(linkReferences, doc.slice(labelNode.from, labelNode.to))
      : undefined;
  return {
    kind: "link",
    href,
    children: buildLinkChildren(node, doc, linkReferences),
  };
}

function buildImageFragment(
  node: SyntaxNode,
  doc: string,
  linkReferences?: LinkReferenceMap,
): InlineFragment {
  const range = getDelimitedRange(node, "LinkMark");
  const rawAlt = range ? doc.slice(range.from, range.to) : "";
  const alt = range ? buildInlineFragmentsRaw(node, doc, range.from, range.to, linkReferences) : [];
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

function htmlTagName(source: string): "br" | "sub" | "sup" | "/sub" | "/sup" | null {
  const normalized = source.trim().toLocaleLowerCase();
  if (/^<br\s*\/?>$/.test(normalized)) return "br";
  if (normalized === "<sub>") return "sub";
  if (normalized === "</sub>") return "/sub";
  if (normalized === "<sup>") return "sup";
  if (normalized === "</sup>") return "/sup";
  return null;
}

function buildInlineFragment(
  node: SyntaxNode,
  doc: string,
  linkReferences?: LinkReferenceMap,
): InlineFragment[] {
  if (MARK_NODES.has(node.name)) {
    return [];
  }

  switch (node.name) {
    case "Emphasis":
      return [{ kind: "emphasis", children: buildInlineFragmentsRaw(node, doc, undefined, undefined, linkReferences) }];
    case "StrongEmphasis":
      return [{ kind: "strong", children: buildInlineFragmentsRaw(node, doc, undefined, undefined, linkReferences) }];
    case "Strikethrough":
      return [{ kind: "strikethrough", children: buildInlineFragmentsRaw(node, doc, undefined, undefined, linkReferences) }];
    case "Highlight":
      return [{ kind: "highlight", children: buildInlineFragmentsRaw(node, doc, undefined, undefined, linkReferences) }];
    case "InlineCode":
      return [{ kind: "code", text: getCodeText(node, doc) }];
    case "InlineMath": {
      const { latex, raw } = getInlineMath(node, doc);
      return [{ kind: "math", latex, raw }];
    }
    case "Link":
      return [buildLinkFragment(node, doc, linkReferences)];
    case "URL": {
      const href = doc.slice(node.from, node.to);
      return [{ kind: "link", href, children: [{ kind: "text", text: href }] }];
    }
    case "Image":
      return [buildImageFragment(node, doc, linkReferences)];
    case "FootnoteRef":
      return [buildFootnoteFragment(node, doc)];
    case "Escape": {
      const text = createTextFragment(doc.slice(node.from + 1, node.to));
      return text ? [text] : [];
    }
    case "HardBreak":
      return [{ kind: "hard-break" }];
    case "HTMLTag": {
      const tag = htmlTagName(doc.slice(node.from, node.to));
      return tag === "br" ? [{ kind: "hard-break" }] : [];
    }
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
      case "html-element":
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
  linkReferences?: LinkReferenceMap,
): InlineFragment[] {
  const from = rangeFrom ?? node.from;
  const to = rangeTo ?? node.to;
  const fragments: InlineFragment[] = [];
  let pos = from;
  let child = node.firstChild;

  childLoop:
  while (child) {
    if (child.to > from && child.from < to) {
      if (child.name === "HTMLTag") {
        const tag = htmlTagName(doc.slice(child.from, child.to));
        if (tag === "sub" || tag === "sup") {
          let close = child.nextSibling;
          while (close) {
            if (close.name === "HTMLTag" && htmlTagName(doc.slice(close.from, close.to)) === `/${tag}`) {
              if (child.from > pos) {
                const text = createTextFragment(doc.slice(pos, child.from));
                if (text) fragments.push(text);
              }
              fragments.push({
                kind: "html-element",
                tagName: tag,
                children: buildInlineFragmentsRaw(
                  node,
                  doc,
                  child.to,
                  close.from,
                  linkReferences,
                ),
              });
              pos = close.to;
              child = close.nextSibling;
              continue childLoop;
            }
            close = close.nextSibling;
          }
        }
      }
      if (child.from > pos) {
        const text = createTextFragment(doc.slice(pos, child.from));
        if (text) fragments.push(text);
      }
      fragments.push(...buildInlineFragment(child, doc, linkReferences));
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

function getRootNode(node: SyntaxNode): SyntaxNode {
  let root = node;
  while (root.parent) {
    root = root.parent;
  }
  return root;
}

export function buildInlineFragments(
  node: SyntaxNode,
  doc: string,
  rangeFrom?: number,
  rangeTo?: number,
): InlineFragment[] {
  return normalizeNarrativeReferences(
    buildInlineFragmentsRaw(
      node,
      doc,
      rangeFrom,
      rangeTo,
      collectLinkReferencesFromTree(getRootNode(node), doc),
    ),
  );
}

export function parseInlineFragments(text: string): InlineFragment[] {
  if (!text) return [];

  const tree = inlineParser.parse(text);
  const linkReferences = collectLinkReferencesFromTree(tree, text);
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) {
    return normalizeNarrativeReferences([{ kind: "text", text }]);
  }

  const fragments: InlineFragment[] = [];
  if (para.from > 0) {
    fragments.push({ kind: "text", text: text.slice(0, para.from) });
  }
  fragments.push(...buildInlineFragmentsRaw(para, text, undefined, undefined, linkReferences));
  if (para.to < text.length) {
    fragments.push({ kind: "text", text: text.slice(para.to) });
  }
  return normalizeNarrativeReferences(fragments);
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
