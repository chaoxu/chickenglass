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
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import {
  $createTextNode,
  $isElementNode,
  $isNodeSelection,
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
  $createFootnoteReferenceNode,
  $isFootnoteReferenceNode,
} from "./nodes/footnote-reference-node";
import {
  $createInlineMathNode,
  $isInlineMathNode,
  type InlineMathDelimiter,
} from "./nodes/inline-math-node";
import { $createReferenceNode, $isReferenceNode } from "./nodes/reference-node";

export interface RevealSubject {
  /** The live node the user is currently "inside". Will be replaced on commit. */
  readonly node: LexicalNode;
  /** Markdown source the reveal surface initially shows. */
  readonly source: string;
}

export interface RevealAdapter {
  readonly id: string;
  /** Find the subject this adapter owns for the given selection, or null. */
  findSubject(selection: BaseSelection): RevealSubject | null;
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
    return {
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

// ─── Decorator adapters (math / reference / footnote) ──────────────────

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
    const raw = math.getRaw();
    const source = math.getDelimiter() === "paren" ? `\\(${raw}\\)` : `$${raw}$`;
    return { node: math, source };
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    let inner: string | null = null;
    let delimiter: InlineMathDelimiter = "dollar";
    if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 3) {
      inner = trimmed.slice(1, -1);
    } else if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 5) {
      inner = trimmed.slice(2, -2);
      delimiter = "paren";
    }
    if (inner == null) {
      return live;
    }
    const math = $createInlineMathNode(inner, delimiter);
    live.replace(math);
    return math;
  },
};

const BRACKETED_REFERENCE = /^\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]$/;
const NARRATIVE_REFERENCE = /^@[A-Za-z0-9_](?:[\w.:-]*\w)?$/;

const referenceAdapter: RevealAdapter = {
  id: "reference",
  findSubject(selection) {
    const ref = findSelectedDecorator(selection, $isReferenceNode);
    if (!ref) {
      return null;
    }
    return { node: ref, source: ref.getRaw() };
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    if (!BRACKETED_REFERENCE.test(trimmed) && !NARRATIVE_REFERENCE.test(trimmed)) {
      return live;
    }
    const ref = $createReferenceNode(trimmed);
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
    return { node: ref, source: ref.getRaw() };
  },
  reparse(live, raw) {
    const trimmed = raw.trim();
    if (!FOOTNOTE_REFERENCE.test(trimmed)) {
      return live;
    }
    const ref = $createFootnoteReferenceNode(trimmed);
    live.replace(ref);
    return ref;
  },
};

// ─── Registry ───────────────────────────────────────────────────────────

/**
 * Order matters: decorator adapters claim NodeSelection cases first;
 * link claims any range selection inside an `<a>` (a more specific scope
 * than text-format); text-format is the fallback for raw styled runs.
 *
 * `inlineMathAdapter` is intentionally excluded from the active list:
 * `InlineMathSourcePlugin` still owns math editing with its own richer UX
 * (arrow-key entry, dedicated anchor lookup). Keeping the adapter exported
 * but out of the registry lets us migrate math later without churning the
 * adapter surface.
 */
export const REVEAL_ADAPTERS: readonly RevealAdapter[] = [
  referenceAdapter,
  footnoteReferenceAdapter,
  linkAdapter,
  textFormatAdapter,
];

export { inlineMathAdapter };

export const REVEAL_NODE_DEPENDENCIES = [LinkNode];

export function pickRevealSubject(
  selection: BaseSelection,
): { adapter: RevealAdapter; subject: RevealSubject } | null {
  for (const adapter of REVEAL_ADAPTERS) {
    const subject = adapter.findSubject(selection);
    if (subject) {
      return { adapter, subject };
    }
  }
  return null;
}
