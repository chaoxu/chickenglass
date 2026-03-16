import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import {
  cursorInRange,
  collectNodes,
  buildDecorations,
  RenderWidget,
} from "./render-utils";

const HEADING_TYPES = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
]);

/** Widget that displays a rendered heading. */
export class HeadingWidget extends RenderWidget {
  constructor(
    private readonly text: string,
    private readonly level: number,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement(`h${this.level}` as keyof HTMLElementTagNameMap) as HTMLElement;
    el.className = "cg-heading";
    el.textContent = this.text;
    return el;
  }

  eq(other: HeadingWidget): boolean {
    return this.text === other.text && this.level === other.level;
  }
}

/** Extract heading level from node type name like "ATXHeading3". */
function headingLevel(typeName: string): number {
  return parseInt(typeName.charAt(typeName.length - 1), 10);
}

/** Collect decoration ranges for headings outside the cursor. */
export function collectHeadingRanges(view: EditorView): Range<Decoration>[] {
  const nodes = collectNodes(view, HEADING_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (cursorInRange(view, node.from, node.to)) continue;

    const level = headingLevel(node.type);
    const raw = view.state.sliceDoc(node.from, node.to);
    const text = raw.replace(/^#{1,6}\s*/, "");
    const widget = new HeadingWidget(text, level);
    widget.sourceFrom = node.from;
    items.push(
      Decoration.replace({ widget }).range(node.from, node.to),
    );
  }

  return items;
}

/** Build a DecorationSet for headings (convenience wrapper). */
export function headingDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectHeadingRanges(view));
}
