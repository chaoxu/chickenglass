import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import {
  cursorInRange,
  collectNodes,
  buildDecorations,
  RenderWidget,
} from "./render-utils";

const IMAGE_TYPES = new Set(["Image"]);

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
    wrapper.className = "cg-image-wrapper";

    const img = document.createElement("img");
    img.className = "cg-image";
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    img.style.maxWidth = "100%";

    img.addEventListener("error", () => {
      wrapper.textContent = `[Image: ${this.alt}]`;
      wrapper.className = "cg-image-error";
    });

    wrapper.appendChild(img);
    return wrapper;
  }

  eq(other: ImageWidget): boolean {
    return this.alt === other.alt && this.src === other.src;
  }
}

/** Parse ![alt](src) from the document range. */
function parseImageContent(
  view: EditorView,
  from: number,
  to: number,
): { alt: string; src: string } | null {
  const raw = view.state.sliceDoc(from, to);
  const match = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(raw);
  if (match && match[2]) {
    return { alt: match[1], src: match[2] };
  }
  return null;
}

/** Collect decoration ranges for images outside the cursor. */
export function collectImageRanges(view: EditorView): Range<Decoration>[] {
  const nodes = collectNodes(view, IMAGE_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (cursorInRange(view, node.from, node.to)) continue;

    const parsed = parseImageContent(view, node.from, node.to);
    if (!parsed) continue;

    const widget = new ImageWidget(parsed.alt, parsed.src);
    items.push(
      Decoration.replace({ widget }).range(node.from, node.to),
    );
  }

  return items;
}

/** Build a DecorationSet for images (convenience wrapper). */
export function imageDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectImageRanges(view));
}
