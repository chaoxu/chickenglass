import {
  Decoration,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, type Range, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import {
  type VisibleRange,
  mergeRanges,
} from "./viewport-diff";
import {
  addMarkerReplacement,
  decorationHidden,
} from "./decoration-core";
import { cursorInRange } from "./node-collection";
import { createCursorSensitiveViewPlugin } from "./view-plugin-factories";
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
const linkDecorationCache = new Map<string, Decoration>();

/** Source-delimiter decoration: reduced-size metrics so visible delimiters
 *  don't push the line box taller than surrounding content (#789). */
const sourceDelimiterDecoration = Decoration.mark({ class: "cf-source-delimiter" });

/** Mark node types whose visible delimiters need source-delimiter styling.
 *  CodeMark is excluded — cf-inline-code already wraps the entire InlineCode range. */
const SOURCE_DELIMITER_MARKS = new Set(["EmphasisMark", "StrikethroughMark", "HighlightMark"]);

/**
 * Recursively walk a subtree and add source-delimiter decorations to all
 * matching mark nodes. Handles nested inline elements (e.g. `***x***` where
 * Emphasis wraps StrongEmphasis) that the main tree walk won't visit because
 * the outer handler returns false (#789).
 */
function addSourceDelimitersInSubtree(node: SyntaxNode, items: Range<Decoration>[]): void {
  let child = node.firstChild;
  while (child) {
    if (SOURCE_DELIMITER_MARKS.has(child.name)) {
      items.push(sourceDelimiterDecoration.range(child.from, child.to));
    }
    addSourceDelimitersInSubtree(child, items);
    child = child.nextSibling;
  }
}

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
    addSourceDelimitersInSubtree(node.node, ctx.items);
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
      let linkDeco = linkDecorationCache.get(url);
      if (!linkDeco) {
        linkDeco = Decoration.mark({
          class: "cf-link-rendered",
          attributes: { "data-url": url },
        });
        linkDecorationCache.set(url, linkDeco);
      }
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
  // Recursively decorate all mark nodes in the subtree so nested inline
  // elements (e.g. ***x***, **a *b* c**) also get reduced metrics (#789).
  if (cursorInRange(view, node.from, node.to)) {
    addSourceDelimitersInSubtree(node.node, items);
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

function normalizeDirtyRange(
  from: number,
  to: number,
  docLength: number,
): VisibleRange {
  const start = Math.max(0, Math.min(from, docLength));
  const end = Math.max(0, Math.min(to, docLength));
  if (start !== end) {
    return start < end ? { from: start, to: end } : { from: end, to: start };
  }
  if (docLength === 0) {
    return { from: 0, to: 0 };
  }
  const windowStart = Math.max(0, Math.min(start, docLength - 1));
  return { from: windowStart, to: Math.min(docLength, windowStart + 1) };
}

function mapNodeRange(
  update: ViewUpdate,
  from: number,
  to: number,
): VisibleRange {
  return normalizeDirtyRange(
    update.changes.mapPos(from, 1),
    update.changes.mapPos(to, -1),
    update.state.doc.length,
  );
}

function collectMarkdownDirtyRangesInState(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
  pushRange: (from: number, to: number) => void,
): void {
  const tree = syntaxTree(state);
  const seen = new Set<string>();
  const pushNodeRange = (from: number, to: number) => {
    const key = `${from}:${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    pushRange(from, to);
  };

  tree.iterate({
    from: rangeFrom,
    to: rangeTo,
    enter(node) {
      if (MARKDOWN_HANDLERS.has(node.name)) {
        pushNodeRange(node.from, node.to);
      }
    },
  });

  const positions = rangeFrom === rangeTo ? [rangeFrom] : [rangeFrom, rangeTo];
  for (const pos of positions) {
    const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(clampedPos, side);
      while (true) {
        if (MARKDOWN_HANDLERS.has(node.name)) {
          pushNodeRange(node.from, node.to);
        }
        const parent = node.parent;
        if (!parent) break;
        node = parent;
      }
    }
  }
}

interface CursorContextEntry extends VisibleRange {
  readonly key: string;
}

interface CursorContextSnapshot {
  readonly key: string;
  readonly entries: readonly CursorContextEntry[];
}

function collectCursorContextSnapshot(
  state: EditorState,
  focused = true,
): CursorContextSnapshot {
  if (!focused) {
    return { key: "", entries: [] };
  }

  const { from, to } = state.selection.main;
  const tree = syntaxTree(state);
  const entriesByKey = new Map<string, CursorContextEntry>();

  const positions = from === to ? [from] : [from, to];
  for (const pos of positions) {
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(pos, side);
      while (node.parent) {
        if (CURSOR_SENSITIVE_NODES.has(node.name) && from >= node.from && to <= node.to) {
          const key = `${node.name}:${node.from}:${node.to}`;
          if (!entriesByKey.has(key)) {
            entriesByKey.set(key, { key, from: node.from, to: node.to });
          }
        }
        node = node.parent;
      }
    }
  }

  const entries = [...entriesByKey.values()].sort((a, b) =>
    a.from - b.from || a.to - b.to || a.key.localeCompare(b.key)
  );
  return {
    key: entries.length === 0
      ? ""
      : entries.length === 1
        ? entries[0].key
        : entries.map((entry) => entry.key).join("|"),
    entries,
  };
}

const cursorChangeRangeCache = new WeakMap<ViewUpdate, readonly VisibleRange[]>();

function focusStates(update: ViewUpdate): { readonly startFocused: boolean; readonly endFocused: boolean } {
  const endFocused = update.view.hasFocus;
  return {
    startFocused: update.focusChanged ? !endFocused : endFocused,
    endFocused,
  };
}

export function computeMarkdownContextChangeRanges(
  update: ViewUpdate,
): readonly VisibleRange[] {
  const cached = cursorChangeRangeCache.get(update);
  if (cached) return cached;

  const { startFocused, endFocused } = focusStates(update);
  const startContext = collectCursorContextSnapshot(update.startState, startFocused);
  const endContext = collectCursorContextSnapshot(update.state, endFocused);

  if (startContext.key === endContext.key) {
    cursorChangeRangeCache.set(update, []);
    return [];
  }

  const nextEntries = new Map(endContext.entries.map((entry) => [entry.key, entry] as const));
  const dirtyRanges: VisibleRange[] = [];

  for (const entry of startContext.entries) {
    if (!nextEntries.has(entry.key)) {
      dirtyRanges.push(mapNodeRange(update, entry.from, entry.to));
    }
  }

  const previousKeys = new Set(startContext.entries.map((entry) => entry.key));
  for (const entry of endContext.entries) {
    if (!previousKeys.has(entry.key)) {
      dirtyRanges.push(normalizeDirtyRange(entry.from, entry.to, update.state.doc.length));
    }
  }

  const mergedDirtyRanges = mergeRanges(dirtyRanges);
  cursorChangeRangeCache.set(update, mergedDirtyRanges);
  return mergedDirtyRanges;
}

function markdownCursorContextChanged(update: ViewUpdate): boolean {
  return computeMarkdownContextChangeRanges(update).length > 0;
}

/**
 * Return a key identifying all cursor-sensitive nodes that contain the
 * primary selection. Changes in this key mean the cursor crossed a
 * node boundary that affects marker visibility.
 *
 * Checks both resolve directions at each selection endpoint to handle
 * inclusive-end boundaries (cursorInRange uses pos <= node.to).
 */
export function cursorContextKey(state: EditorState): string {
  return collectCursorContextSnapshot(state).key;
}

/**
 * Narrowed shouldUpdate for markdown-render (#579).
 *
 * Rebuilds on structural changes (doc, tree, viewport) unconditionally.
 * For selection/focus changes, only rebuilds when the cursor context crosses
 * a cursor-sensitive node boundary — i.e., moved into, out of, or between
 * nodes that toggle marker visibility, or when focus changes whether those
 * nodes should render as source.
 */
export function markdownShouldUpdate(update: ViewUpdate): boolean {
  if (
    update.docChanged ||
    update.viewportChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  ) {
    return true;
  }

  if (update.selectionSet || update.focusChanged) {
    return markdownCursorContextChanged(update);
  }

  return false;
}

/**
 * Dirty-range narrowing for markdown doc changes (#823).
 *
 * Expands literal edits to any markdown-rendered nodes that overlap the change
 * in the old or new tree so mapped decorations outside those fragments stay
 * valid, and merges in any local cursor/focus context changes for the same
 * transaction.
 */
export function computeMarkdownDocChangeRanges(
  update: ViewUpdate,
): readonly VisibleRange[] | null {
  const dirtyRanges = [...computeMarkdownContextChangeRanges(update)];
  const pushRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, update.state.doc.length));
  };

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    pushRange(fromB, toB);
    collectMarkdownDirtyRangesInState(update.startState, fromA, toA, (nodeFrom, nodeTo) => {
      dirtyRanges.push(mapNodeRange(update, nodeFrom, nodeTo));
    });
    collectMarkdownDirtyRangesInState(update.state, fromB, toB, pushRange);
  });

  return mergeRanges(dirtyRanges);
}

/**
 * Collect markdown decoration ranges (headings, emphasis, links, etc.).
 *
 * Dispatches each node to its registered handler via MARKDOWN_HANDLERS.
 * Each handler has per-type semantics: some always apply styles, some
 * toggle marker visibility, some skip children entirely.
 *
 * Incremental callers pass `skip(node.from)` for retained boundary nodes.
 * Markdown applies that only to the node itself and still walks children so
 * local rebuilds can update nested dirty descendants without duplicating the
 * parent decorations.
 */
function collectMarkdownItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const ctx: MarkdownHandlerContext = { view, items: [], cursorInHeading: false };
  const tree = syntaxTree(view.state);
  const seenNodes = new Set<string>();

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const handler = MARKDOWN_HANDLERS.get(node.name);
        if (!handler) return undefined;
        const nodeKey = `${node.name}:${node.from}:${node.to}`;
        if (seenNodes.has(nodeKey)) {
          return undefined;
        }
        seenNodes.add(nodeKey);
        if (skip(node.from) && node.from < from) {
          return undefined;
        }
        return handler.handle(node, ctx);
      },
    });
  }

  return ctx.items;
}

export { collectMarkdownItems as _collectMarkdownItemsForTest };

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = createCursorSensitiveViewPlugin(
  collectMarkdownItems,
  {
    contextChangeRanges: computeMarkdownContextChangeRanges,
    docChangeRanges: computeMarkdownDocChangeRanges,
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
