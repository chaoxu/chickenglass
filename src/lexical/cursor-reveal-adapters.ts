/**
 * Per-node-type adapters for the cursor reveal plugin.
 *
 * An adapter answers two questions for one kind of inline subtree:
 *  - Given the current selection, what node should we reveal, and what
 *    markdown source represents it?
 *  - Given an edited source string, what node should replace the live
 *    plain-text reveal node when the caret leaves?
 *
 * The plugin walks adapters in order and picks the first match. Each
 * adapter is tiny and self-contained so adding a new kind of revealable
 * inline (e.g. citations) is a single new entry in the registry.
 */
import { $generateNodesFromSerializedNodes } from "@lexical/clipboard";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import { $isListNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type BaseSelection,
  type LexicalNode,
  type TextNode,
} from "lexical";

import {
  getInlineTextFormatSpecs,
  type InlineTextFormatSpec,
} from "../lexical-next/model/inline-text-format-family";
import {
  $exportLexicalNodeToJSON,
  parseMarkdownFragmentToJSON,
  serializeBlockToMarkdown,
} from "./headless-markdown-parse";
import {
  $createFootnoteReferenceNode,
  $isFootnoteReferenceNode,
  type FootnoteReferenceNode,
} from "./nodes/footnote-reference-node";
import {
  $createHeadingAttributeNode,
  $isHeadingAttributeNode,
  type HeadingAttributeNode,
} from "./nodes/heading-attribute-node";
import {
  $createInlineImageNode,
  $isInlineImageNode,
  type InlineImageNode,
} from "./nodes/inline-image-node";
import {
  inlineMathBodyEndOffset,
  inlineMathBodyStartOffset,
  inlineMathSourceOffsetFromTarget,
} from "./math-source-position";
import {
  $createInlineMathNode,
  $isInlineMathNode,
  type InlineMathNode,
  type InlineMathDelimiter,
} from "./nodes/inline-math-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $createReferenceNode, $isReferenceNode, type ReferenceNode } from "./nodes/reference-node";
import type { RevealChromePreview } from "./reveal-chrome-types";

export type RevealBoundaryDirection = "backward" | "forward";

export type RevealEntryContext =
  | {
      readonly entry: "pointer";
      readonly clientX?: number;
      readonly target: EventTarget | null;
    }
  | {
      readonly direction: RevealBoundaryDirection;
      readonly entry: "keyboard-boundary";
    };

export interface RevealSubject {
  /** The live node the user is currently "inside". Will be replaced on commit. */
  readonly node: LexicalNode;
  /** Markdown source the reveal surface initially shows. */
  readonly source: string;
  /**
   * Caret offset (within `source`) the reveal should land on when it
   * opens. Optional: the plugin falls back to the legacy "infer from
   * preferredOffset" path for adapters that don't provide one. Block-
   * scope adapters use this to map the caret's visible position inside
   * the block to an approximate source position so the caret doesn't
   * always end up at end-of-source.
   */
  readonly caretOffset?: number;
}

export interface RevealAdapter {
  readonly id: string;
  /** Find the subject this adapter owns for the given selection, or null. */
  findSubject(selection: BaseSelection): RevealSubject | null;
  /**
   * Find the subject this adapter owns for a concrete node entered by
   * non-range-selection mechanisms: decorator click, or keyboard movement
   * across an inline decorator boundary.
   */
  findSubjectFromNode?(
    node: LexicalNode,
    context: RevealEntryContext,
  ): RevealSubject | null;
  /** Optional chrome shown next to the live source while inline reveal is active. */
  getChromePreview?(source: string): RevealChromePreview | null;
  /**
   * Replace `live` (a plain TextNode the inline reveal swapped in) with a
   * fresh node parsed from `raw`. Adapters fall back to a plain TextNode
   * when the source no longer matches their grammar.
   */
  reparse(live: TextNode, raw: string): LexicalNode;
}

// ─── Text-format adapter ────────────────────────────────────────────────

function activeFormatSpecs(node: TextNode): readonly InlineTextFormatSpec[] {
  return getInlineTextFormatSpecs().filter((spec) => node.hasFormat(spec.lexicalFormat));
}

export function wrapWithSpecs(text: string, specs: readonly InlineTextFormatSpec[]): string {
  const open = specs.map((s) => s.markdownOpen).join("");
  const close = [...specs].reverse().map((s) => s.markdownClose).join("");
  return `${open}${text}${close}`;
}

export function unwrapSource(raw: string): {
  readonly text: string;
  readonly specs: readonly InlineTextFormatSpec[];
} {
  const specs: InlineTextFormatSpec[] = [];
  let text = raw;
  let peeled = true;
  while (peeled) {
    peeled = false;
    for (const spec of getInlineTextFormatSpecs()) {
      const min = spec.markdownOpen.length + spec.markdownClose.length;
      if (
        text.length >= min + 1 &&
        text.startsWith(spec.markdownOpen) &&
        text.endsWith(spec.markdownClose)
      ) {
        text = text.slice(spec.markdownOpen.length, text.length - spec.markdownClose.length);
        specs.push(spec);
        peeled = true;
        break;
      }
    }
  }
  return { text, specs };
}

const textFormatAdapter: RevealAdapter = {
  id: "text-format",
  findSubject(selection) {
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return null;
    }
    const node = selection.anchor.getNode();
    if (!$isTextNode(node)) {
      return null;
    }
    const specs = activeFormatSpecs(node);
    if (specs.length === 0) {
      return null;
    }
    // Only reveal when caret is strictly *inside* the formatted run.
    // At an end boundary (offset 0 or offset === length), the user is
    // either about to type adjacent content or has just finished a
    // markdown shortcut transform that placed the caret there. Revealing
    // in either case hijacks normal typing flow.
    const offset = selection.anchor.offset;
    const length = node.getTextContentSize();
    if (offset <= 0 || offset >= length) {
      return null;
    }
    return { node, source: wrapWithSpecs(node.getTextContent(), specs) };
  },
  reparse(live, raw) {
    const { text, specs } = unwrapSource(raw);
    const replacement = $createTextNode(text);
    for (const spec of specs) {
      replacement.toggleFormat(spec.lexicalFormat);
    }
    live.replace(replacement);
    return replacement;
  },
};

// ─── Link adapter ───────────────────────────────────────────────────────

const LINK_PATTERN = /^\[([\s\S]*)\]\(([^)\n]+)\)$/;

function findAncestor<T extends LexicalNode>(
  start: LexicalNode,
  predicate: (node: LexicalNode) => node is T,
): T | null {
  let cursor: LexicalNode | null = start;
  while (cursor) {
    if (predicate(cursor)) {
      return cursor;
    }
    cursor = cursor.getParent();
  }
  return null;
}

function computeVisibleOffsetWithin(
  root: LexicalNode,
  anchorNode: LexicalNode,
  anchorOffset: number,
): number {
  let visible = 0;
  let found = false;

  function walk(node: LexicalNode): void {
    if (found) {
      return;
    }
    if (node === anchorNode) {
      visible += anchorOffset;
      found = true;
      return;
    }
    if ($isTextNode(node)) {
      visible += node.getTextContentSize();
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
        if (found) {
          return;
        }
      }
      return;
    }
    visible += node.getTextContent().length;
  }

  walk(root);
  return visible;
}

const linkAdapter: RevealAdapter = {
  id: "link",
  findSubject(selection) {
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return null;
    }
    const link = findAncestor(selection.anchor.getNode(), $isLinkNode);
    if (!link) {
      return null;
    }
    const visibleOffset = computeVisibleOffsetWithin(
      link,
      selection.anchor.getNode(),
      selection.anchor.offset,
    );
    const linkTextLength = link.getTextContent().length;
    return {
      caretOffset: 1 + Math.max(0, Math.min(visibleOffset, linkTextLength)),
      node: link,
      source: `[${link.getTextContent()}](${link.getURL()})`,
    };
  },
  reparse(live, raw) {
    const match = raw.trim().match(LINK_PATTERN);
    if (!match) {
      // Invalid syntax — leave whatever the user typed as plain text.
      return live;
    }
    const [, text, url] = match;
    const link = $createLinkNode(url.trim());
    link.append($createTextNode(text));
    live.replace(link);
    return link;
  },
};

// ─── Decorator adapters (math / image / reference / footnote) ──────────

function findSelectedDecorator<T extends LexicalNode>(
  selection: BaseSelection,
  predicate: (node: LexicalNode) => node is T,
): T | null {
  if ($isNodeSelection(selection)) {
    const nodes = selection.getNodes();
    if (nodes.length !== 1) {
      return null;
    }
    const [only] = nodes;
    return predicate(only) ? only : null;
  }
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    // Range selections never land *inside* a decorator (they have no
    // editable text), but Lexical sometimes parks the anchor on the
    // decorator's parent element with an offset that addresses the
    // decorator child.
    const anchor = selection.anchor;
    const node = anchor.getNode();
    if (predicate(node)) {
      return node;
    }
    if ($isElementNode(node)) {
      const child = node.getChildAtIndex(anchor.offset);
      if (child && predicate(child)) {
        return child;
      }
    }
  }
  return null;
}

const inlineMathAdapter: RevealAdapter = {
  id: "inline-math",
  findSubject(selection) {
    const math = findSelectedDecorator(selection, $isInlineMathNode);
    if (!math) {
      return null;
    }
    return inlineMathSubject(math);
  },
  findSubjectFromNode(node, context) {
    if (!$isInlineMathNode(node)) {
      return null;
    }
    return inlineMathSubject(node, context);
  },
  getChromePreview() {
    return { kind: "inline-math-preview" };
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    let delimiter: InlineMathDelimiter | null = null;
    if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 3) {
      delimiter = "dollar";
    } else if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 5) {
      delimiter = "paren";
    }
    if (delimiter == null) {
      return live;
    }
    const math = $createInlineMathNode(trimmed, delimiter, live.getFormat());
    live.replace(math);
    return math;
  },
};

const INLINE_IMAGE = /^!\[[^\]\n]*\]\([^)]+\)$/;

const inlineImageAdapter: RevealAdapter = {
  id: "inline-image",
  findSubject(selection) {
    const image = findSelectedDecorator(selection, $isInlineImageNode);
    if (!image) {
      return null;
    }
    return rawDecoratorSubject(image);
  },
  findSubjectFromNode(node, context) {
    if (!$isInlineImageNode(node)) {
      return null;
    }
    return rawDecoratorSubject(node, context);
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    if (!INLINE_IMAGE.test(trimmed)) {
      return live;
    }
    const image = $createInlineImageNode(trimmed, live.getFormat());
    live.replace(image);
    return image;
  },
};

const HEADING_ATTRIBUTE = /^\s+\{[^{}\n]*\}$/;

const headingAttributeAdapter: RevealAdapter = {
  id: "heading-attribute",
  findSubject(selection) {
    const attribute = findSelectedDecorator(selection, $isHeadingAttributeNode);
    if (!attribute) {
      return null;
    }
    return rawDecoratorSubject(attribute);
  },
  findSubjectFromNode(node, context) {
    if (!$isHeadingAttributeNode(node)) {
      return null;
    }
    return rawDecoratorSubject(node, context);
  },
  reparse(live, raw) {
    if (!HEADING_ATTRIBUTE.test(raw)) {
      return live;
    }
    const attribute = $createHeadingAttributeNode(raw);
    live.replace(attribute);
    return attribute;
  },
};

function inlineMathSubject(
  math: InlineMathNode,
  context?: RevealEntryContext,
): RevealSubject {
  const source = math.getRaw();
  let caretOffset: number | undefined;
  if (context?.entry === "pointer") {
    caretOffset = inlineMathSourceOffsetFromTarget(
      context.target,
      source,
      context.clientX,
    ) ?? undefined;
  } else if (context?.entry === "keyboard-boundary") {
    caretOffset = context.direction === "forward"
      ? inlineMathBodyStartOffset(source)
      : inlineMathBodyEndOffset(source);
  }

  // InlineMathNode.__raw already includes its delimiters (the markdown
  // text-match transformer in `markdown.ts` stores the full match, so
  // `getTextContent()` round-trips identically). Don't re-wrap.
  return { caretOffset, node: math, source };
}

const BRACKETED_REFERENCE = /^\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]$/;
const NARRATIVE_REFERENCE = /^@[A-Za-z0-9_](?:[\w.:-]*\w)?$/;

const referenceAdapter: RevealAdapter = {
  id: "reference",
  findSubject(selection) {
    const ref = findSelectedDecorator(selection, $isReferenceNode);
    if (!ref) {
      return null;
    }
    return rawDecoratorSubject(ref);
  },
  findSubjectFromNode(node, context) {
    if (!$isReferenceNode(node)) {
      return null;
    }
    return rawDecoratorSubject(node, context);
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    if (!BRACKETED_REFERENCE.test(trimmed) && !NARRATIVE_REFERENCE.test(trimmed)) {
      return live;
    }
    const ref = $createReferenceNode(trimmed, live.getFormat());
    live.replace(ref);
    return ref;
  },
};

const FOOTNOTE_REFERENCE = /^\[\^[^\]\n]+\]$/;

const footnoteReferenceAdapter: RevealAdapter = {
  id: "footnote-reference",
  findSubject(selection) {
    const ref = findSelectedDecorator(selection, $isFootnoteReferenceNode);
    if (!ref) {
      return null;
    }
    return rawDecoratorSubject(ref);
  },
  findSubjectFromNode(node, context) {
    if (!$isFootnoteReferenceNode(node)) {
      return null;
    }
    return rawDecoratorSubject(node, context);
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    if (!FOOTNOTE_REFERENCE.test(trimmed)) {
      return live;
    }
    const ref = $createFootnoteReferenceNode(trimmed, live.getFormat());
    live.replace(ref);
    return ref;
  },
};

function rawDecoratorSubject(
  node:
    | FootnoteReferenceNode
    | HeadingAttributeNode
    | InlineImageNode
    | ReferenceNode,
  context?: RevealEntryContext,
): RevealSubject {
  const source = node.getRaw();
  const caretOffset = context?.entry === "keyboard-boundary"
    ? context.direction === "forward" ? 0 : source.length
    : undefined;
  return { caretOffset, node, source };
}

// ─── Raw block / paragraph-scope adapters ───────────────────────────────

/**
 * Top-level block kinds we surface as raw markdown source. Most
 * decorator blocks are excluded because they don't round-trip cleanly
 * through the standard transformers, but `RawBlockNode` is included:
 * it stores its full markdown source verbatim in `__raw`, so the
 * round-trip is trivially correct.
 *
 * Code blocks, tables, image blocks, frontmatter, and footnote
 * definitions remain excluded — each has its own dedicated edit
 * affordance.
 */
function isRevealableTopLevelBlock(node: LexicalNode): boolean {
  return $isParagraphNode(node)
    || $isHeadingNode(node)
    || $isQuoteNode(node)
    || $isListNode(node)
    || $isRawBlockNode(node);
}

/**
 * Walk `top`'s descendants in document order, summing visible text
 * lengths until we encounter `anchorNode`, then add `anchorOffset`.
 * Returns an approximate visible-text offset of the caret inside the
 * block. The paragraph adapter uses this as a heuristic source offset
 * — formatting markers (`*`, `**`, `[…]`) shift the actual source
 * offset by a few chars, but the result lands close enough that the
 * caret no longer always ends up at end-of-source.
 */
function $computeBlockVisibleOffset(
  top: LexicalNode,
  anchorNode: LexicalNode,
  anchorOffset: number,
): number {
  let visible = 0;
  let found = false;
  function walk(node: LexicalNode): void {
    if (found) {
      return;
    }
    if (node === anchorNode) {
      visible += anchorOffset;
      found = true;
      return;
    }
    if ($isTextNode(node)) {
      visible += node.getTextContentSize();
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
        if (found) {
          return;
        }
      }
      return;
    }
    // Decorator with a textual representation (inline math, refs).
    visible += node.getTextContent().length;
  }
  walk(top);
  return visible;
}

const paragraphAdapter: RevealAdapter = {
  id: "paragraph",
  findSubject(selection) {
    let top: LexicalNode | null = null;
    let caretOffset: number | undefined;

    if ($isRangeSelection(selection)) {
      const anchor = selection.anchor;
      const anchorNode = anchor.getNode();
      top = anchorNode.getTopLevelElement();
      if (top && isRevealableTopLevelBlock(top)) {
        caretOffset = $computeBlockVisibleOffset(top, anchorNode, anchor.offset);
      }
    } else if ($isNodeSelection(selection)) {
      // Decorator click (e.g. clicking a theorem block) lands here. The
      // selected node is the block itself, already at top level.
      const nodes = selection.getNodes();
      if (nodes.length === 1 && isRevealableTopLevelBlock(nodes[0])) {
        top = nodes[0];
      }
    }

    if (!top || !isRevealableTopLevelBlock(top)) {
      return null;
    }

    // Serialize just this block's subtree into the raw markdown the
    // user will edit. We can't pass `top` to `$convertToMarkdownString`
    // directly: it treats its `node` arg as a *root-like* container and
    // exports each child as a top-level element, but a paragraph's
    // children are TextNodes (not top-level), so the export comes back
    // empty. The headless workspace wraps the block at root for us. The
    // recursive helper is required because `top.exportJSON()` alone
    // returns an empty children array.
    const source = serializeBlockToMarkdown($exportLexicalNodeToJSON(top)).replace(/\n+$/, "");
    return { node: top, source, caretOffset };
  },
  findSubjectFromNode(node) {
    if (!isRevealableTopLevelBlock(node)) {
      return null;
    }
    const source = serializeBlockToMarkdown($exportLexicalNodeToJSON(node)).replace(/\n+$/, "");
    return { node, source };
  },
  reparse(live, raw) {
    return reparseBlockReveal(live, raw);
  },
};

const rawBlockAdapter: RevealAdapter = {
  id: "raw-block",
  findSubject() {
    return null;
  },
  findSubjectFromNode() {
    return null;
  },
  reparse(live, raw) {
    return reparseBlockReveal(live, raw);
  },
};

function reparseBlockReveal(live: TextNode, raw: string): LexicalNode {
  // The live node is the placeholder TextNode inside the wrapper paragraph
  // that openInlineReveal swapped in for the original block. Splice parsed
  // block(s) in before the wrapper, then drop the wrapper.
  const wrapper = live.getTopLevelElement();
  if (!wrapper) {
    return live;
  }
  const blocks = parseMarkdownFragmentToJSON(raw);
  if (blocks.length === 0) {
    const empty = $createParagraphNode();
    wrapper.replace(empty);
    return empty;
  }
  const nodes = $generateNodesFromSerializedNodes([...blocks]);
  if (nodes.length === 0) {
    const empty = $createParagraphNode();
    wrapper.replace(empty);
    return empty;
  }
  for (const node of nodes) {
    wrapper.insertBefore(node);
  }
  wrapper.remove();
  return nodes[0];
}

// ─── Registry ───────────────────────────────────────────────────────────

/**
 * Order matters: decorator adapters claim NodeSelection cases first;
 * link claims any range selection inside an `<a>` (a more specific scope
 * than text-format); text-format is the fallback for raw styled runs.
 */
export const REVEAL_ADAPTERS: readonly RevealAdapter[] = [
  inlineMathAdapter,
  inlineImageAdapter,
  referenceAdapter,
  footnoteReferenceAdapter,
  headingAttributeAdapter,
  rawBlockAdapter,
  linkAdapter,
  textFormatAdapter,
];

/**
 * Single-entry adapter list for paragraph-scope reveal mode. The
 * paragraph adapter handles any cursor position inside a revealable
 * top-level block; per-element adapters are deliberately omitted so the
 * whole block opens as one source surface instead of just the inline
 * token under the caret.
 */
export const PARAGRAPH_REVEAL_ADAPTERS: readonly RevealAdapter[] = [paragraphAdapter];

export const REVEAL_NODE_DEPENDENCIES = [LinkNode];

export function pickRevealSubject(
  selection: BaseSelection,
  adapters: readonly RevealAdapter[] = REVEAL_ADAPTERS,
): { adapter: RevealAdapter; subject: RevealSubject } | null {
  for (const adapter of adapters) {
    const subject = adapter.findSubject(selection);
    if (subject) {
      return { adapter, subject };
    }
  }
  return null;
}

export function pickRevealSubjectFromNode(
  node: LexicalNode,
  context: RevealEntryContext,
  adapters: readonly RevealAdapter[] = REVEAL_ADAPTERS,
): { adapter: RevealAdapter; subject: RevealSubject } | null {
  for (const adapter of adapters) {
    const subject = adapter.findSubjectFromNode?.(node, context);
    if (subject) {
      return { adapter, subject };
    }
  }
  return null;
}
