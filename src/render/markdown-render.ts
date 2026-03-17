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
];

/** Node types whose text content should be hidden (markers, URLs, etc.). */
const HIDDEN_NODES = [
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "HardBreak",
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
          // --- ATX Headings: style text + hide HeaderMark ---
          if (node.name.startsWith("ATXHeading")) {
            // If cursor is inside this heading and editor is focused, show source
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false;
            }

            // Apply heading style decoration to the entire heading node
            const headingDeco = headingDecorationByLevel[node.name];
            if (headingDeco) {
              widgets.push(headingDeco.range(node.from, node.to));
            }

            // Don't return false here -- we want to walk children to find HeaderMark
            return;
          }

          // --- HeaderMark (the # symbols + trailing space) ---
          if (node.name === "HeaderMark") {
            // Hide the marker and any trailing space after it
            const end = node.to;
            const docLen = view.state.doc.length;
            const nextChar =
              end < docLen ? view.state.sliceDoc(end, end + 1) : "";
            const hideEnd = nextChar === " " ? end + 1 : end;
            widgets.push(decorationHidden.range(node.from, hideEnd));
            return;
          }

          // --- Inline elements: skip tree walk if cursor is inside ---
          if (ELEMENT_NODES.includes(node.name)) {
            if (
              hasFocus &&
              cursor.from >= node.from &&
              cursor.to <= node.to
            ) {
              return false;
            }
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
