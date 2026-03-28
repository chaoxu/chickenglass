import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, type Range, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { cursorInRange, decorationHidden, addMarkerReplacement, createSimpleViewPlugin } from "./render-utils";
import { findTrailingHeadingAttributes } from "../semantics/heading-ancestry";
import { isSafeUrl } from "../lib/url-utils";
import { openExternalUrl } from "../lib/open-link";

/**
 * Node types whose children's markers should be hidden when
 * the cursor is NOT inside them.
 */
const ELEMENT_NODES = new Set([
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Image",
  "Strikethrough",
]);

/** Node types whose text content should be hidden (markers, URLs, etc.). */
const HIDDEN_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "HardBreak",
  "StrikethroughMark",
  "HighlightMark",
]);

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

/** Decoration to style bullet list markers. */
const bulletListDecoration = Decoration.mark({ class: "cf-list-bullet" });

/** Decoration to style ordered list markers. */
const numberListDecoration = Decoration.mark({ class: "cf-list-number" });

/**
 * All node types whose marker visibility depends on cursor proximity.
 * Must stay in sync with the cursorInRange checks in buildMarkdownDecorations.
 */
const CURSOR_SENSITIVE_NODES = new Set([
  ...ELEMENT_NODES,
  "ATXHeading1", "ATXHeading2", "ATXHeading3",
  "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "Highlight", "Link", "HorizontalRule", "Escape",
]);

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

/** Map from element node names to their content style decorations. */
const styleMap: Readonly<Record<string, Decoration>> = {
  StrongEmphasis: boldDecoration,
  Emphasis: italicDecoration,
  Strikethrough: strikethroughDecoration,
  InlineCode: inlineCodeDecoration,
};

/**
 * Build markdown decoration set (headings, emphasis, links, etc.).
 *
 * NOTE: collectNodeRangesExcludingCursor() does not apply here.
 * This function handles many distinct node types with different logic per type:
 * headings apply styles unconditionally then conditionally hide markers,
 * links build Decoration.mark from child nodes, inline elements toggle cursor
 * visibility, and hidden-marker nodes are always removed. The cursor check is
 * not a uniform "skip this node entirely" — each branch has its own semantics
 * (some return false, some return, some apply marks before checking). There is
 * no single uniform widget type being pushed, so the helper's single-callback
 * shape cannot capture this multi-branch dispatch.
 */
function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  // Track whether the current heading has cursor inside.
  // Set by the ATXHeading handler, read by the HeaderMark handler.
  // This allows inline formatting children to be walked normally
  // (per-node cursor checks) while still showing # markers when editing.
  let cursorInHeading = false;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // --- ATX Headings: ALWAYS apply heading style, walk children for inline rendering ---
        // Follows the same marker/content split as block titles (CLAUDE.md):
        // - Heading-level styling (mark + line decorations) always applied
        // - # markers shown/hidden based on cursor proximity to the heading
        // - Inline formatting (bold, italic, math, code) inside the heading
        //   keeps its rendered state — only direct cursor contact shows source
        if (node.name.startsWith("ATXHeading")) {
          const headingMark = headingMarkByLevel[node.name];
          if (headingMark) {
            widgets.push(headingMark.range(node.from, node.to));
          }
          // Line decoration puts font-size on .cm-line so math widgets inherit it
          const headingLine = headingLineByLevel[node.name];
          if (headingLine) {
            const line = view.state.doc.lineAt(node.from);
            widgets.push(headingLine.range(line.from));
          }

          cursorInHeading = cursorInRange(view, node.from, node.to);

          if (!cursorInHeading) {
            // Cursor outside: hide ALL trailing Pandoc attribute blocks
            // ({#id}, {.class}, {-}, {.unnumbered}, {#id .class key=value}, etc.)
            const hLine = view.state.doc.lineAt(node.from);
            const attrMatch = findTrailingHeadingAttributes(hLine.text);
            if (attrMatch) {
              const attrFrom = hLine.from + attrMatch.index;
              const attrTo = attrFrom + attrMatch.raw.length;
              widgets.push(decorationHidden.range(attrFrom, attrTo));
            }
          }
          // Always walk children: HeaderMark uses cursorInHeading flag,
          // inline formatting nodes get per-node cursor checks via ELEMENT_NODES.
          return;
        }

        // --- HeaderMark (the # symbols + trailing space) ---
        // Uses the same marker replacement pattern as fenced div headers.
        // See addMarkerReplacement() and CLAUDE.md "Block headers must behave like headings."
        if (node.name === "HeaderMark") {
          const end = node.to;
          const docLen = view.state.doc.length;
          const nextChar =
            end < docLen ? view.state.sliceDoc(end, end + 1) : "";
          const hideEnd = nextChar === " " ? end + 1 : end;
          // When cursor is on the heading line, markers stay visible (cursorInside=true).
          // When cursor is outside, markers are hidden (cursorInside=false).
          addMarkerReplacement(node.from, hideEnd, cursorInHeading, null, widgets);
          return;
        }

        // --- Highlight: ALWAYS apply highlight decoration, hide markers when cursor outside ---
        if (node.name === "Highlight") {
          widgets.push(highlightDecoration.range(node.from, node.to));
          if (cursorInRange(view, node.from, node.to)) {
            return false; // keep highlight style, show markers
          }
          return; // walk children to hide HighlightMark
        }

        // --- Link: style as clickable link when cursor is outside ---
        if (node.name === "Link") {
          if (cursorInRange(view, node.from, node.to)) {
            return false; // cursor inside: show full source for editing
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
              widgets.push(linkDeco.range(textFrom, textTo));
            }
          }
          // Walk children to hide markers (LinkMark, URL) via HIDDEN_NODES
          return;
        }

        // --- Inline elements: ALWAYS apply content styling, toggle marker visibility ---
        if (ELEMENT_NODES.has(node.name)) {
          // Always apply content styling for seamless WYSIWYG
          const styleDeco = styleMap[node.name];
          if (styleDeco) {
            widgets.push(styleDeco.range(node.from, node.to));
          }

          // If cursor is inside: skip hiding markers (show source) but keep style
          if (cursorInRange(view, node.from, node.to)) {
            return false;
          }
          // Cursor outside: walk children to hide markers
          return;
        }

        // --- FencedCode: handled entirely by code-block-render plugin ---
        if (node.name === "FencedCode") {
          return false; // don't walk children — avoids hiding CodeMark fence markers
        }

        // --- Hidden marker nodes ---
        if (HIDDEN_NODES.has(node.name)) {
          widgets.push(decorationHidden.range(node.from, node.to));
          return;
        }

        // --- HorizontalRule: style if cursor is not inside ---
        if (node.name === "HorizontalRule") {
          if (cursorInRange(view, node.from, node.to)) {
            return false;
          }
          widgets.push(hrDecoration.range(node.from, node.to));
          return;
        }

        // --- Escape: hide the backslash (\$ → $, \* → *) unless cursor is on it ---
        if (node.name === "Escape") {
          if (cursorInRange(view, node.from, node.to)) return;
          // Hide just the backslash (first character)
          widgets.push(Decoration.replace({}).range(node.from, node.from + 1));
          return;
        }

        // --- ListMark: always style bullet/number markers (no source revert) ---
        // List markers aren't source syntax like # or $ — they should keep
        // the content font even when the cursor is on them.
        if (node.name === "ListMark") {
          const grandparent = node.node.parent?.parent?.name;
          const deco =
            grandparent === "BulletList"
              ? bulletListDecoration
              : numberListDecoration;
          widgets.push(deco.range(node.from, node.to));
          return;
        }

      },
    });
  }

  return Decoration.set(widgets, true);
}

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = createSimpleViewPlugin(
  buildMarkdownDecorations,
  {
    shouldUpdate: markdownShouldUpdate,
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
