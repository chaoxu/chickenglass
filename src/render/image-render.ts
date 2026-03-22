import { type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  type EditorView,
} from "@codemirror/view";
import {
  cursorInRange,
  buildDecorations,
  RenderWidget,
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

/** Collect decoration ranges for images outside the cursor. */
function collectImageRanges(view: EditorView): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "Image") return;
      if (cursorInRange(view, node.from, node.to)) return;

      const parsed = readImageContent(view, node.node);
      if (!parsed) return;

      const widget = new ImageWidget(parsed.alt, parsed.src);
      widget.sourceFrom = node.from;
      widget.sourceTo = node.to;
      items.push(
        Decoration.replace({ widget }).range(node.from, node.to),
      );
    },
  });

  return items;
}

/** Build a DecorationSet for images (convenience wrapper). */
function imageDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectImageRanges(view));
}

class ImageRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = imageDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.decorations = imageDecorations(update.view);
    }
  }
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = ViewPlugin.fromClass(
  ImageRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
