import {
  Decoration,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
  type EditorView,
  ViewPlugin,
} from "@codemirror/view";
import { type Range, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { decorationHidden } from "./render-utils";

/**
 * Node types whose children's markers should be hidden when
 * the cursor is NOT inside them.
 */
const ELEMENT_NODES = [
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Link",
  "Image",
  "Strikethrough",
];

/** Node types whose text content should be hidden (markers, URLs, etc.). */
const HIDDEN_NODES = [
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "HardBreak",
  "QuoteMark",
  "StrikethroughMark",
  "HighlightMark",
];

/** Heading style decorations keyed by ATXHeading level. */
const headingDecorationByLevel: Record<string, Decoration> = {
  ATXHeading1: Decoration.mark({ class: "cg-heading-1" }),
  ATXHeading2: Decoration.mark({ class: "cg-heading-2" }),
  ATXHeading3: Decoration.mark({ class: "cg-heading-3" }),
  ATXHeading4: Decoration.mark({ class: "cg-heading-4" }),
  ATXHeading5: Decoration.mark({ class: "cg-heading-5" }),
  ATXHeading6: Decoration.mark({ class: "cg-heading-6" }),
};

/** Decoration to style horizontal rules. */
const hrDecoration = Decoration.mark({ class: "cg-hr" });

/** Decoration to style blockquotes. */
const blockquoteDecoration = Decoration.mark({ class: "cg-blockquote" });

/** Decoration to style highlighted text. Always applied (like headings). */
const highlightDecoration = Decoration.mark({ class: "cg-highlight" });

/** Content style decorations — always applied for seamless WYSIWYG. */
const boldDecoration = Decoration.mark({ class: "cg-bold" });
const italicDecoration = Decoration.mark({ class: "cg-italic" });
const strikethroughDecoration = Decoration.mark({ class: "cg-strikethrough" });
const inlineCodeDecoration = Decoration.mark({ class: "cg-inline-code" });

/** Decoration to style bullet list markers. */
const bulletListDecoration = Decoration.mark({ class: "cg-list-bullet" });

/** Decoration to style ordered list markers. */
const numberListDecoration = Decoration.mark({ class: "cg-list-number" });

class MarkdownRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.process(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.decorations = this.process(update.view);
    }
  }

  private process(view: EditorView): DecorationSet {
    const widgets: Range<Decoration>[] = [];
    const cursor = view.state.selection.main;
    const hasFocus = view.hasFocus;

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter(node) {
          // --- ATX Headings: ALWAYS apply heading style, only hide markers when cursor outside ---
          if (node.name.startsWith("ATXHeading")) {
            const headingDeco = headingDecorationByLevel[node.name];
            if (headingDeco) {
              widgets.push(headingDeco.range(node.from, node.to));
            }

            // If cursor is inside: keep heading style but skip hiding markers
            // The # will appear at the same heading font size = seamless WYSIWYG
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false; // don't walk children, so HeaderMark won't be hidden
            }
            // Cursor outside: walk children to find and hide HeaderMark
            return;
          }

          // --- HeaderMark (the # symbols + trailing space) ---
          if (node.name === "HeaderMark") {
            const end = node.to;
            const docLen = view.state.doc.length;
            const nextChar =
              end < docLen ? view.state.sliceDoc(end, end + 1) : "";
            const hideEnd = nextChar === " " ? end + 1 : end;
            widgets.push(decorationHidden.range(node.from, hideEnd));
            return;
          }

          // --- Highlight: ALWAYS apply highlight decoration, hide markers when cursor outside ---
          if (node.name === "Highlight") {
            widgets.push(highlightDecoration.range(node.from, node.to));
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false; // keep highlight style, show markers
            }
            return; // walk children to hide HighlightMark
          }

          // --- Inline elements: ALWAYS apply content styling, toggle marker visibility ---
          if (ELEMENT_NODES.includes(node.name)) {
            // Always apply content styling for seamless WYSIWYG
            const styleMap: Record<string, Decoration> = {
              StrongEmphasis: boldDecoration,
              Emphasis: italicDecoration,
              Strikethrough: strikethroughDecoration,
              InlineCode: inlineCodeDecoration,
            };
            const styleDeco = styleMap[node.name];
            if (styleDeco) {
              widgets.push(styleDeco.range(node.from, node.to));
            }

            // If cursor is inside: skip hiding markers (show source) but keep style
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false;
            }
            // Cursor outside: walk children to hide markers
            return;
          }

          // --- Hidden marker nodes ---
          if (HIDDEN_NODES.includes(node.name)) {
            widgets.push(decorationHidden.range(node.from, node.to));
            return;
          }

          // --- HorizontalRule: style if cursor is not inside ---
          if (node.name === "HorizontalRule") {
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false;
            }
            widgets.push(hrDecoration.range(node.from, node.to));
            return;
          }

          // --- ListMark: style bullet/number markers when cursor is not on same line ---
          if (node.name === "ListMark") {
            if (hasFocus) {
              const line = view.state.doc.lineAt(node.from);
              if (cursor.from >= line.from && cursor.from <= line.to) return;
            }
            const grandparent = node.node.parent?.parent?.name;
            const deco =
              grandparent === "BulletList"
                ? bulletListDecoration
                : numberListDecoration;
            widgets.push(deco.range(node.from, node.to));
            return;
          }

          // --- Blockquote: apply decoration and hide QuoteMark when cursor outside ---
          if (node.name === "Blockquote") {
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false; // cursor inside: show source markers, no decoration
            }
            widgets.push(blockquoteDecoration.range(node.from, node.to));
            // Walk children so QuoteMark nodes are hidden by HIDDEN_NODES handler
            return;
          }
        },
      });
    }

    return Decoration.set(widgets, true);
  }
}

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = ViewPlugin.fromClass(
  MarkdownRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
