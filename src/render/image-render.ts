import { type Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  type DecorationSet,
  type EditorView,
} from "@codemirror/view";
import {
  buildDecorations,
  collectNodeRangesExcludingCursor,
  pushWidgetDecoration,
  RenderWidget,
  createSimpleViewPlugin,
} from "./render-utils";

/** Widget that renders an inline image. */
export class ImageWidget extends RenderWidget {
  constructor(
    private readonly alt: string,
    private readonly src: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cf-image-wrapper";

    const img = document.createElement("img");
    img.className = "cf-image";
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    img.addEventListener("error", () => {
      wrapper.textContent = `[Image: ${this.alt}]`;
      wrapper.className = "cf-image-error";
    });

    wrapper.appendChild(img);
    return wrapper;
  }

  eq(other: ImageWidget): boolean {
    return this.alt === other.alt && this.src === other.src;
  }
}

/** Read alt/src from an Image syntax node. */
function readImageContent(
  view: EditorView,
  node: SyntaxNode,
): { alt: string; src: string } | null {
  const urlNode = node.getChild("URL");
  if (!urlNode) return null;

  const src = view.state.sliceDoc(urlNode.from, urlNode.to);
  if (!src) return null;

  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2
    ? view.state.sliceDoc(marks[0].to, marks[1].from)
    : "";

  return { alt, src };
}

const IMAGE_TYPES = new Set(["Image"]);

/** Collect decoration ranges for images outside the cursor. */
function collectImageRanges(view: EditorView) {
  return collectNodeRangesExcludingCursor(view, IMAGE_TYPES, (node, items) => {
    const parsed = readImageContent(view, node.node);
    if (!parsed) return;

    pushWidgetDecoration(items, new ImageWidget(parsed.alt, parsed.src), node.from, node.to);
  });
}

/** Build a DecorationSet for images (convenience wrapper). */
function imageDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectImageRanges(view));
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = createSimpleViewPlugin(
  imageDecorations,
);
