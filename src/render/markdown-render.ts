import {
  Decoration,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, type Range, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { type VisibleRange, cursorInRange, decorationHidden, addMarkerReplacement, createCursorSensitiveViewPlugin } from "./render-utils";
import { findTrailingHeadingAttributes } from "../semantics/heading-ancestry";
import { isSafeUrl } from "../lib/url-utils";
import { openExternalUrl } from "../lib/open-link";

/** Heading mark decorations (font-weight, text styling on spans). */
const headingMarkByLevel: Record<string, Decoration> = {
  ATXHeading1: Decoration.mark({ class: "cf-heading-1" }),
  ATXHeading2: Decoration.mark({ class: "cf-heading-2" }),
  ATXHeading3: Decoration.mark({ class: "cf-heading-3" }),
  ATXHeading4: Decoration.mark({ class: "cf-heading-4" }),
  ATXHeading5: Decoration.mark({ class: "cf-heading-5" }),
  ATXHeading6: Decoration.mark({ class: "cf-heading-6" }),
};

/**
 * Heading line decorations (font-size on .cm-line).
 * Font-size lives here so ALL children (including math widgets) inherit it,
 * rather than only text spans wrapped by Decoration.mark.
 */
const headingLineByLevel: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({ class: "cf-heading-line-1" }),
  ATXHeading2: Decoration.line({ class: "cf-heading-line-2" }),
  ATXHeading3: Decoration.line({ class: "cf-heading-line-3" }),
  ATXHeading4: Decoration.line({ class: "cf-heading-line-4" }),
  ATXHeading5: Decoration.line({ class: "cf-heading-line-5" }),
  ATXHeading6: Decoration.line({ class: "cf-heading-line-6" }),
};

/** Decoration to style horizontal rules. */
const hrDecoration = Decoration.mark({ class: "cf-hr" });

/** Decoration to style highlighted text. Always applied (like headings). */
const highlightDecoration = Decoration.mark({ class: "cf-highlight" });

/** Content style decorations — always applied for seamless WYSIWYG. */
const boldDecoration = Decoration.mark({ class: "cf-bold" });
const italicDecoration = Decoration.mark({ class: "cf-italic" });
const strikethroughDecoration = Decoration.mark({ class: "cf-strikethrough" });
const inlineCodeDecoration = Decoration.mark({ class: "cf-inline-code" });

/** Source-delimiter decoration: reduced-size metrics so visible delimiters
 *  don't push the line box taller than surrounding content (#789). */
const sourceDelimiterDecoration = Decoration.mark({ class: "cf-source-delimiter" });

/** Mark node types whose visible delimiters need source-delimiter styling.
 *  CodeMark is excluded — cf-inline-code already wraps the entire InlineCode range. */
const SOURCE_DELIMITER_MARKS = new Set(["EmphasisMark", "StrikethroughMark", "HighlightMark"]);

/** Decoration to style bullet list markers. */
const bulletListDecoration = Decoration.mark({ class: "cf-list-bullet" });

/** Decoration to style ordered list markers. */
const numberListDecoration = Decoration.mark({ class: "cf-list-number" });

/** Map from element node names to their content style decorations. */
const styleMap: Readonly<Record<string, Decoration>> = {
  StrongEmphasis: boldDecoration,
  Emphasis: italicDecoration,
  Strikethrough: strikethroughDecoration,
  InlineCode: inlineCodeDecoration,
};

// ── Markdown node handler registry ─────────────────────────────────────

/** Shared mutable context passed to handlers during tree iteration. */
interface MarkdownHandlerContext {
  readonly view: EditorView;
  readonly items: Range<Decoration>[];
  /** Set by ATXHeading handler, read by HeaderMark handler. */
  cursorInHeading: boolean;
}

/** Entry in the markdown node handler registry. */
interface MarkdownNodeHandler {
  /** Whether this node toggles rendering based on cursor proximity. */
  readonly cursorSensitive: boolean;
  /**
   * Handle a matching node. Return value follows Lezer enter() semantics:
   * undefined = walk children, false = skip children.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: CM6-style callback convention; false means skip, void means continue
  readonly handle: (node: SyntaxNodeRef, ctx: MarkdownHandlerContext) => false | void;
}

// ── Handler functions ──────────────────────────────────────────────────

/**
 * ATX Headings: ALWAYS apply heading style, walk children for inline rendering.
 * Follows the same marker/content split as block titles (CLAUDE.md):
 * - Heading-level styling (mark + line decorations) always applied
 * - # markers shown/hidden based on cursor proximity to the heading
 * - Inline formatting (bold, italic, math, code) inside the heading
 *   keeps its rendered state — only direct cursor contact shows source
 */
function handleHeading(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const { view, items } = ctx;
  const headingMark = headingMarkByLevel[node.name];
  if (headingMark) {
    items.push(headingMark.range(node.from, node.to));
  }
  const headingLine = headingLineByLevel[node.name];
  if (headingLine) {
    const line = view.state.doc.lineAt(node.from);
    items.push(headingLine.range(line.from));
  }

  ctx.cursorInHeading = cursorInRange(view, node.from, node.to);

  if (!ctx.cursorInHeading) {
    // Cursor outside: hide ALL trailing Pandoc attribute blocks
    // ({#id}, {.class}, {-}, {.unnumbered}, {#id .class key=value}, etc.)
    const hLine = view.state.doc.lineAt(node.from);
    const attrMatch = findTrailingHeadingAttributes(hLine.text);
    if (attrMatch) {
      const attrFrom = hLine.from + attrMatch.index;
      const attrTo = attrFrom + attrMatch.raw.length;
      items.push(decorationHidden.range(attrFrom, attrTo));
    }
  }
  // Always walk children: HeaderMark uses cursorInHeading flag,
  // inline formatting nodes get per-node cursor checks via element handler.
}

/**
 * HeaderMark (the # symbols + trailing space).
 * Uses the same marker replacement pattern as fenced div headers.
 * See addMarkerReplacement() and CLAUDE.md "Block headers must behave like headings."
 */
function handleHeaderMark(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const { view, items } = ctx;
  const end = node.to;
  const docLen = view.state.doc.length;
  const nextChar = end < docLen ? view.state.sliceDoc(end, end + 1) : "";
  const hideEnd = nextChar === " " ? end + 1 : end;
  // When cursor is on the heading line, markers stay visible (cursorInside=true).
  // When cursor is outside, markers are hidden (cursorInside=false).
  addMarkerReplacement(node.from, hideEnd, ctx.cursorInHeading, null, items);
}

/** Highlight: ALWAYS apply highlight decoration, hide markers when cursor outside. */
function handleHighlight(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  ctx.items.push(highlightDecoration.range(node.from, node.to));
  if (cursorInRange(ctx.view, node.from, node.to)) {
    // Apply source-delimiter decoration to visible HighlightMark nodes (#789)
    let child = node.node.firstChild;
    while (child) {
      if (child.name === "HighlightMark") {
        ctx.items.push(sourceDelimiterDecoration.range(child.from, child.to));
      }
      child = child.nextSibling;
    }
    return false as const; // keep highlight style, show markers
  }
  // Walk children to hide HighlightMark
}

/** Link: style as clickable link when cursor is outside. */
function handleLink(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const { view, items } = ctx;
  if (cursorInRange(view, node.from, node.to)) {
    return false as const; // cursor inside: show full source for editing
  }
  // Extract URL from the URL child node
  let url = "";
  const linkNode = node.node;
  const urlChild = linkNode.getChild("URL");
  if (urlChild) {
    url = view.state.sliceDoc(urlChild.from, urlChild.to);
  }
  // Find the link text range: between first [ and ]
  // The text is between the first LinkMark end and second LinkMark start
  const marks: { from: number; to: number }[] = [];
  let cursor = linkNode.firstChild;
  while (cursor) {
    if (cursor.name === "LinkMark") {
      marks.push({ from: cursor.from, to: cursor.to });
    }
    cursor = cursor.nextSibling;
  }
  // marks[0] = "[", marks[1] = "]", marks[2] = "("
  if (marks.length >= 2) {
    const textFrom = marks[0].to;
    const textTo = marks[1].from;
    if (textFrom < textTo) {
      const linkDeco = Decoration.mark({
        class: "cf-link-rendered",
        attributes: { "data-url": url },
      });
      items.push(linkDeco.range(textFrom, textTo));
    }
  }
  // Walk children to hide markers (LinkMark, URL) via hidden handler
}

/** Inline elements: ALWAYS apply content styling, toggle marker visibility. */
function handleElement(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const { view, items } = ctx;
  // Always apply content styling for seamless WYSIWYG
  const styleDeco = styleMap[node.name];
  if (styleDeco) {
    items.push(styleDeco.range(node.from, node.to));
  }

  // If cursor is inside: skip hiding markers (show source) but keep style.
  // Apply source-delimiter decoration to visible mark nodes so they use
  // reduced metrics instead of falling back to generic .tok-meta (#789).
  if (cursorInRange(view, node.from, node.to)) {
    let child = node.node.firstChild;
    while (child) {
      if (SOURCE_DELIMITER_MARKS.has(child.name)) {
        items.push(sourceDelimiterDecoration.range(child.from, child.to));
      }
      child = child.nextSibling;
    }
    return false as const;
  }
  // Cursor outside: walk children to hide markers
}

/** FencedCode: handled entirely by code-block-render plugin. */
function handleFencedCode() {
  return false as const; // don't walk children — avoids hiding CodeMark fence markers
}

/** Hidden marker nodes: always hidden (markers, URLs, etc.). */
function handleHidden(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  ctx.items.push(decorationHidden.range(node.from, node.to));
}

/** HorizontalRule: style if cursor is not inside. */
function handleHorizontalRule(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  if (cursorInRange(ctx.view, node.from, node.to)) {
    return false as const;
  }
  ctx.items.push(hrDecoration.range(node.from, node.to));
}

/** Escape: hide the backslash (\$ → $, \* → *) unless cursor is on it. */
function handleEscape(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  if (cursorInRange(ctx.view, node.from, node.to)) return;
  // Hide just the backslash (first character)
  ctx.items.push(Decoration.replace({}).range(node.from, node.from + 1));
}

/** ListMark: always style bullet/number markers (no source revert).
 * List markers aren't source syntax like # or $ — they should keep
 * the content font even when the cursor is on them. */
function handleListMark(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const grandparent = node.node.parent?.parent?.name;
  const deco =
    grandparent === "BulletList"
      ? bulletListDecoration
      : numberListDecoration;
  ctx.items.push(deco.range(node.from, node.to));
}

// ── Registry population ────────────────────────────────────────────────

/**
 * Unified markdown node handler registry.
 *
 * Each entry maps a Lezer node type name to its rendering handler and
 * declares whether the node toggles visibility based on cursor proximity.
 * CURSOR_SENSITIVE_NODES is derived from this registry — there is no
 * separate manually-maintained list.
 */
const MARKDOWN_HANDLERS = new Map<string, MarkdownNodeHandler>();

for (const name of Object.keys(headingMarkByLevel)) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: true, handle: handleHeading });
}
MARKDOWN_HANDLERS.set("HeaderMark", { cursorSensitive: false, handle: handleHeaderMark });
MARKDOWN_HANDLERS.set("Highlight", { cursorSensitive: true, handle: handleHighlight });
MARKDOWN_HANDLERS.set("Link", { cursorSensitive: true, handle: handleLink });
for (const name of ["Emphasis", "StrongEmphasis", "InlineCode", "Image", "Strikethrough"]) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: true, handle: handleElement });
}
MARKDOWN_HANDLERS.set("FencedCode", { cursorSensitive: false, handle: handleFencedCode });
for (const name of ["EmphasisMark", "CodeMark", "LinkMark", "URL", "HardBreak", "StrikethroughMark", "HighlightMark"]) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: false, handle: handleHidden });
}
MARKDOWN_HANDLERS.set("HorizontalRule", { cursorSensitive: true, handle: handleHorizontalRule });
MARKDOWN_HANDLERS.set("Escape", { cursorSensitive: true, handle: handleEscape });
MARKDOWN_HANDLERS.set("ListMark", { cursorSensitive: false, handle: handleListMark });

/**
 * All node types whose marker visibility depends on cursor proximity.
 * Derived from the handler registry — no separate list to maintain.
 */
const CURSOR_SENSITIVE_NODES = new Set(
  [...MARKDOWN_HANDLERS].filter(([, h]) => h.cursorSensitive).map(([name]) => name),
);

/**
 * Return a key identifying all cursor-sensitive nodes that contain the
 * primary selection. Changes in this key mean the cursor crossed a
 * node boundary that affects marker visibility.
 *
 * Checks both resolve directions at each selection endpoint to handle
 * inclusive-end boundaries (cursorInRange uses pos <= node.to).
 */
export function cursorContextKey(state: EditorState): string {
  const { from, to } = state.selection.main;
  const tree = syntaxTree(state);
  const seen = new Set<string>();

  const positions = from === to ? [from] : [from, to];
  for (const pos of positions) {
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(pos, side);
      while (node.parent) {
        if (CURSOR_SENSITIVE_NODES.has(node.name) && from >= node.from && to <= node.to) {
          seen.add(`${node.name}:${node.from}:${node.to}`);
        }
        node = node.parent;
      }
    }
  }

  if (seen.size === 0) return "";
  if (seen.size === 1) return seen.values().next().value!;
  return [...seen].sort().join("|");
}

/**
 * Narrowed shouldUpdate for markdown-render (#579).
 *
 * Rebuilds on structural changes (doc, tree, viewport, focus) unconditionally.
 * For selection-only changes, only rebuilds when the cursor crosses a
 * cursor-sensitive node boundary — i.e., moved into, out of, or between
 * nodes that toggle marker visibility.
 */
export function markdownShouldUpdate(update: ViewUpdate): boolean {
  if (
    update.docChanged ||
    update.focusChanged ||
    update.viewportChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  ) {
    return true;
  }

  if (update.selectionSet) {
    return cursorContextKey(update.state) !== cursorContextKey(update.startState);
  }

  return false;
}

/**
 * Collect markdown decoration ranges (headings, emphasis, links, etc.).
 *
 * Dispatches each node to its registered handler via MARKDOWN_HANDLERS.
 * Each handler has per-type semantics: some always apply styles, some
 * toggle marker visibility, some skip children entirely.
 *
 * The `_skip` parameter is accepted for CursorSensitiveCollectFn conformance
 * but intentionally unused: markdown decorations are marks / lines / hidden-
 * marks, so duplicates from boundary-straddling nodes are visually harmless.
 */
function collectMarkdownItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  _skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const ctx: MarkdownHandlerContext = { view, items: [], cursorInHeading: false };

  for (const { from, to } of ranges) {
    const c = syntaxTree(view.state).cursor();
    scan: for (;;) {
      let descend = false;
      if (c.from <= to && c.to >= from) {
        const handler = MARKDOWN_HANDLERS.get(c.name);
        descend = handler ? handler.handle(c, ctx) !== false : true;
      }
      if (descend && c.firstChild()) continue;
      for (;;) {
        if (c.nextSibling()) break;
        if (!c.parent()) break scan;
      }
    }
  }

  return ctx.items;
}

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = createCursorSensitiveViewPlugin(
  collectMarkdownItems,
  {
    selectionCheck: (update) => {
      if (!update.selectionSet) return false;
      return cursorContextKey(update.state) !== cursorContextKey(update.startState);
    },
    pluginSpec: {
      eventHandlers: {
        click(event: MouseEvent, _view: EditorView) {
          // Cmd+click (Mac) or Ctrl+click (Win/Linux) on rendered links
          if (!(event.metaKey || event.ctrlKey)) return false;
          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;
          // Walk up to find the element with data-url (the mark decoration span)
          const linkEl = target.closest("[data-url]");
          if (!linkEl) return false;
          const url = linkEl.getAttribute("data-url");
          if (url && isSafeUrl(url)) {
            void openExternalUrl(url);
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    },
  },
);
