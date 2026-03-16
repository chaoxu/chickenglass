import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import {
  cursorInRange,
  collectNodes,
  buildDecorations,
  RenderWidget,
} from "./render-utils";

const LINK_TYPES = new Set(["Link"]);

/** Widget that renders a clickable link. */
export class LinkWidget extends RenderWidget {
  constructor(
    private readonly text: string,
    private readonly url: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("a");
    el.className = "cg-link";
    el.textContent = this.text;
    el.href = this.url;
    el.title = this.url;
    el.rel = "noopener noreferrer";
    el.target = "_blank";
    // Prevent the click from moving the cursor into the widget
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    return el;
  }

  eq(other: LinkWidget): boolean {
    return this.text === other.text && this.url === other.url;
  }
}

/** Parse [text](url) from the document range. */
function parseLinkContent(
  view: EditorView,
  from: number,
  to: number,
): { text: string; url: string } | null {
  const raw = view.state.sliceDoc(from, to);
  const match = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(raw);
  if (match && match[2]) {
    return { text: match[1], url: match[2] };
  }
  return null;
}

/** Collect decoration ranges for links outside the cursor. */
export function collectLinkRanges(view: EditorView): Range<Decoration>[] {
  const nodes = collectNodes(view, LINK_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (cursorInRange(view, node.from, node.to)) continue;

    const parsed = parseLinkContent(view, node.from, node.to);
    if (!parsed) continue;

    items.push(
      Decoration.replace({
        widget: new LinkWidget(parsed.text, parsed.url),
      }).range(node.from, node.to),
    );
  }

  return items;
}

/** Build a DecorationSet for links (convenience wrapper). */
export function linkDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectLinkRanges(view));
}
