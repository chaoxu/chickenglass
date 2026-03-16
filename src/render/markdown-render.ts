import {
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  type EditorView,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { collectHeadingRanges } from "./heading-render";
import { collectInlineRanges } from "./inline-render";
import { collectLinkRanges } from "./link-render";
import { collectImageRanges } from "./image-render";
import { collectHrRanges } from "./hr-render";
import { buildDecorations } from "./render-utils";

class MarkdownRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildAll(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged
    ) {
      this.decorations = this.buildAll(update.view);
    }
  }

  private buildAll(view: EditorView): DecorationSet {
    return buildDecorations([
      ...collectHeadingRanges(view),
      ...collectInlineRanges(view),
      ...collectLinkRanges(view),
      ...collectImageRanges(view),
      ...collectHrRanges(view),
    ]);
  }
}

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = ViewPlugin.fromClass(
  MarkdownRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
