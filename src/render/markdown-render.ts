import {
  Decoration,
  type EditorView,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type EditorState, type Range, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import {
  normalizeDirtyRange,
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
import { containsRange } from "../lib/range-helpers";
import {
  clearLinkDecorationCacheForTest,
  getLinkDecoration,
  linkDecorationCacheSizeForTest,
  openRenderedLinkAtEvent,
} from "./link-handler";
import { addInlineRevealSourceMetricsInSubtree } from "./markdown-inline-source";
import { CSS } from "../constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
import {
  collectLinkReferencesFromState,
  resolveLinkReference,
  type LinkReferenceMap,
} from "../lib/markdown/link-references";

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
  ATXHeading1: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(1),
      "cf-heading-line-1",
    ),
  }),
  ATXHeading2: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(2),
      "cf-heading-line-2",
    ),
  }),
  ATXHeading3: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(3),
      "cf-heading-line-3",
    ),
  }),
  ATXHeading4: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(4),
      "cf-heading-line-4",
    ),
  }),
  ATXHeading5: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(5),
      "cf-heading-line-5",
    ),
  }),
  ATXHeading6: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(6),
      "cf-heading-line-6",
    ),
  }),
};

/** Decoration to style highlighted text. Always applied (like headings). */
const highlightDecoration = Decoration.mark({ class: "cf-highlight" });

/** Content style decorations — always applied for seamless WYSIWYG. */
const boldDecoration = Decoration.mark({ class: CSS.bold });
const italicDecoration = Decoration.mark({ class: CSS.italic });
const strikethroughDecoration = Decoration.mark({ class: CSS.strikethrough });
const inlineCodeDecoration = Decoration.mark({ class: CSS.inlineCode });
const subscriptDecoration = Decoration.mark({ tagName: "sub" });
const superscriptDecoration = Decoration.mark({ tagName: "sup" });

/** Decoration to style ordered list markers. */
const numberListDecoration = Decoration.mark({ class: CSS.listNumber });

/** Map from element node names to their content style decorations. */
const styleMap: Readonly<Record<string, Decoration>> = {
  StrongEmphasis: boldDecoration,
  Emphasis: italicDecoration,
  Strikethrough: strikethroughDecoration,
  InlineCode: inlineCodeDecoration,
};

class HorizontalRuleWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cf-hr";
    hr.setAttribute("aria-hidden", "true");
    return hr;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof HorizontalRuleWidget;
  }
}

class HardBreakWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const br = document.createElement("br");
    br.className = "cf-html-break";
    return br;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof HardBreakWidget;
  }
}

class BulletListMarkerWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = CSS.listBullet;
    span.textContent = "•";
    return span;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof BulletListMarkerWidget;
  }
}

const bulletListMarkerWidget = new BulletListMarkerWidget();

function isCanonicalHtmlBreak(source: string): boolean {
  return /^<br\s*\/?>$/i.test(source);
}

function htmlTagName(source: string): "sub" | "sup" | "/sub" | "/sup" | null {
  const normalized = source.trim().toLocaleLowerCase();
  if (normalized === "<sub>") return "sub";
  if (normalized === "</sub>") return "/sub";
  if (normalized === "<sup>") return "sup";
  if (normalized === "</sup>") return "/sup";
  return null;
}

// ── Markdown node handler registry ─────────────────────────────────────

/** Shared mutable context passed to handlers during tree iteration. */
interface MarkdownHandlerContext {
  readonly view: EditorView;
  readonly items: Range<Decoration>[];
  readonly linkReferences: LinkReferenceMap;
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
    addInlineRevealSourceMetricsInSubtree(node.node, ctx.items);
    return false as const; // keep highlight style, show markers
  }
  // Walk children to hide HighlightMark
}

/** Link: style as clickable link when cursor is outside. */
function handleLink(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const { view, items } = ctx;
  if (cursorInRange(view, node.from, node.to)) {
    addInlineRevealSourceMetricsInSubtree(node.node, items);
    return false as const; // cursor inside: show full source for editing
  }
  // Extract URL from the URL child node
  let url = "";
  const linkNode = node.node;
  const urlChild = linkNode.getChild("URL");
  if (urlChild) {
    url = view.state.sliceDoc(urlChild.from, urlChild.to);
  } else {
    const labelChild = linkNode.getChild("LinkLabel");
    if (labelChild) {
      url = resolveLinkReference(
        ctx.linkReferences,
        view.state.sliceDoc(labelChild.from, labelChild.to),
      ) ?? "";
    }
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
      const linkDeco = getLinkDecoration(url);
      items.push(linkDeco.range(textFrom, textTo));
    }
  }
  // Walk children to hide markers (LinkMark, URL) via hidden handler
}

/** Bare URL autolinks: style as clickable links unless they are link targets. */
function handleUrl(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const parentName = node.node.parent?.name;
  if (parentName === "Link" || parentName === "LinkReference") {
    ctx.items.push(decorationHidden.range(node.from, node.to));
    return;
  }
  if (cursorInRange(ctx.view, node.from, node.to)) {
    return false as const;
  }
  const url = ctx.view.state.sliceDoc(node.from, node.to);
  ctx.items.push(getLinkDecoration(url).range(node.from, node.to));
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
    addInlineRevealSourceMetricsInSubtree(node.node, items);
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
  if (cursorInRange(ctx.view.state, node.from, node.to)) {
    return false as const;
  }
  ctx.items.push(
    Decoration.replace({
      widget: new HorizontalRuleWidget(),
    }).range(node.from, node.to),
  );
}

/** HTMLTag: render allowlisted Pandoc-compatible inline HTML in rich mode. */
function handleHtmlTag(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  if (cursorInRange(ctx.view.state, node.from, node.to)) {
    return false as const;
  }
  const source = ctx.view.state.sliceDoc(node.from, node.to);
  if (isCanonicalHtmlBreak(source)) {
    ctx.items.push(
      Decoration.replace({
        widget: new HardBreakWidget(),
      }).range(node.from, node.to),
    );
    return false as const;
  }

  const tag = htmlTagName(source);
  if (tag === "/sub" || tag === "/sup") {
    ctx.items.push(decorationHidden.range(node.from, node.to));
    return false as const;
  }
  if (tag !== "sub" && tag !== "sup") {
    return undefined;
  }

  let close = node.node.nextSibling;
  while (close) {
    if (close.name === "HTMLTag" && htmlTagName(ctx.view.state.sliceDoc(close.from, close.to)) === `/${tag}`) {
      const decoration = tag === "sub" ? subscriptDecoration : superscriptDecoration;
      ctx.items.push(decoration.range(node.to, close.from));
      ctx.items.push(decorationHidden.range(node.from, node.to));
      return false as const;
    }
    close = close.nextSibling;
  }

  // Unmatched sub/sup tags stay visible as source because hiding one side is ambiguous.
  return undefined;
}

/** Hide source-only blocks such as link definitions and HTML comments outside edits. */
function handleHiddenBlock(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  if (cursorInRange(ctx.view.state, node.from, node.to)) {
    return false as const;
  }
  ctx.items.push(decorationHidden.range(node.from, node.to));
  return false as const;
}

/** Escape: hide the backslash (\$ → $, \* → *) unless cursor is on it. */
function handleEscape(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  if (cursorInRange(ctx.view, node.from, node.to)) return;
  // Hide just the backslash (first character)
  ctx.items.push(Decoration.replace({}).range(node.from, node.from + 1));
}

/** ListMark: always render list markers (no source revert).
 * Ordered markers use their source text because "1." is the rendered form.
 * Unordered markers must be replacement widgets because "-", "*", and "+"
 * are source alternatives for the same rendered bullet glyph.
 */
function handleListMark(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const grandparent = node.node.parent?.parent?.name;
  if (grandparent === "BulletList") {
    ctx.items.push(
      Decoration.replace({ widget: bulletListMarkerWidget }).range(node.from, node.to),
    );
    return;
  }

  ctx.items.push(numberListDecoration.range(node.from, node.to));
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
for (const name of ["EmphasisMark", "CodeMark", "LinkMark", "LinkLabel", "HardBreak", "StrikethroughMark", "HighlightMark"]) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: false, handle: handleHidden });
}
MARKDOWN_HANDLERS.set("URL", { cursorSensitive: true, handle: handleUrl });
MARKDOWN_HANDLERS.set("HorizontalRule", { cursorSensitive: true, handle: handleHorizontalRule });
MARKDOWN_HANDLERS.set("HTMLTag", { cursorSensitive: true, handle: handleHtmlTag });
MARKDOWN_HANDLERS.set("CommentBlock", { cursorSensitive: true, handle: handleHiddenBlock });
MARKDOWN_HANDLERS.set("LinkReference", { cursorSensitive: true, handle: handleHiddenBlock });
MARKDOWN_HANDLERS.set("Escape", { cursorSensitive: true, handle: handleEscape });
MARKDOWN_HANDLERS.set("ListMark", { cursorSensitive: false, handle: handleListMark });

/**
 * All node types whose marker visibility depends on cursor proximity.
 * Derived from the handler registry — no separate list to maintain.
 */
const CURSOR_SENSITIVE_NODES = new Set(
  [...MARKDOWN_HANDLERS].filter(([, h]) => h.cursorSensitive).map(([name]) => name),
);

function uniqueNodeKey(node: SyntaxNodeRef): string {
  return `${node.name}:${node.from}:${node.to}`;
}

function nodeRangeKey(node: SyntaxNodeRef): string {
  return `${node.from}:${node.to}`;
}

function iterateTreeUnique(
  tree: Tree,
  options: {
    readonly from: number;
    readonly to: number;
    readonly key?: (node: SyntaxNodeRef) => string;
    readonly seen?: Set<string>;
    readonly enter: (node: SyntaxNodeRef) => false | undefined;
  },
): void {
  const seenNodes = options.seen ?? new Set<string>();
  const keyForNode = options.key ?? uniqueNodeKey;
  tree.iterate({
    from: options.from,
    to: options.to,
    enter(node) {
      const key = keyForNode(node);
      if (seenNodes.has(key)) return undefined;
      seenNodes.add(key);
      return options.enter(node);
    },
  });
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
  const seenRanges = new Set<string>();
  const pushUniqueRange = (from: number, to: number) => {
    const key = `${from}:${to}`;
    if (seenRanges.has(key)) return;
    seenRanges.add(key);
    pushRange(from, to);
  };

  iterateTreeUnique(tree, {
    from: rangeFrom,
    to: rangeTo,
    key: nodeRangeKey,
    enter(node) {
      if (MARKDOWN_HANDLERS.has(node.name)) {
        pushUniqueRange(node.from, node.to);
      }
      return undefined;
    },
  });

  const positions = rangeFrom === rangeTo ? [rangeFrom] : [rangeFrom, rangeTo];
  for (const pos of positions) {
    const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(clampedPos, side);
      while (true) {
        if (MARKDOWN_HANDLERS.has(node.name)) {
          pushUniqueRange(node.from, node.to);
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
        if (
          CURSOR_SENSITIVE_NODES.has(node.name) &&
          containsRange(node, { from, to })
        ) {
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

function markdownDocChangeNeedsContextMerge(update: ViewUpdate): boolean {
  return update.focusChanged || !update.state.selection.eq(update.startState.selection);
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
  const dirtyRanges = markdownDocChangeNeedsContextMerge(update)
    ? [...computeMarkdownContextChangeRanges(update)]
    : [];
  const pushRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, update.state.doc.length));
  };

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
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
  const ctx: MarkdownHandlerContext = {
    view,
    items: [],
    linkReferences: collectLinkReferencesFromState(view.state),
    cursorInHeading: false,
  };
  const tree = syntaxTree(view.state);
  const seenNodes = new Set<string>();

  for (const { from, to } of ranges) {
    iterateTreeUnique(tree, {
      from,
      to,
      seen: seenNodes,
      enter(node) {
        const handler = MARKDOWN_HANDLERS.get(node.name);
        if (!handler) return undefined;
        if (skip(node.from) && node.from < from) {
          return undefined;
        }
        return handler.handle(node, ctx) === false ? false : undefined;
      },
    });
  }

  return ctx.items;
}

export { collectMarkdownItems as _collectMarkdownItemsForTest };
export { markdownDocChangeNeedsContextMerge as _markdownDocChangeNeedsContextMergeForTest };
export function _clearLinkDecorationCacheForTest(): void {
  clearLinkDecorationCacheForTest();
}
export function _linkDecorationCacheSizeForTest(): number {
  return linkDecorationCacheSizeForTest();
}

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = createCursorSensitiveViewPlugin(
  collectMarkdownItems,
  {
    contextChangeRanges: computeMarkdownContextChangeRanges,
    docChangeRanges: computeMarkdownDocChangeRanges,
    onViewportOnly: "incremental",
    pluginSpec: {
      eventHandlers: {
        click: openRenderedLinkAtEvent,
      },
    },
    spanName: "cm6.markdownRender",
  },
);
