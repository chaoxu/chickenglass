import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import {
  cursorInRange,
  collectNodes,
  buildDecorations,
  RenderWidget,
} from "./render-utils";

const INLINE_TYPES = new Set([
  "StrongEmphasis",
  "Emphasis",
  "InlineCode",
]);

/** Widget that renders bold text. */
export class BoldWidget extends RenderWidget {
  constructor(private readonly text: string) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("strong");
    el.className = "cg-bold";
    el.textContent = this.text;
    return el;
  }

  eq(other: BoldWidget): boolean {
    return this.text === other.text;
  }
}

/** Widget that renders italic text. */
export class ItalicWidget extends RenderWidget {
  constructor(private readonly text: string) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("em");
    el.className = "cg-italic";
    el.textContent = this.text;
    return el;
  }

  eq(other: ItalicWidget): boolean {
    return this.text === other.text;
  }
}

/** Widget that renders inline code. */
export class InlineCodeWidget extends RenderWidget {
  constructor(private readonly text: string) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("code");
    el.className = "cg-inline-code";
    el.textContent = this.text;
    return el;
  }

  eq(other: InlineCodeWidget): boolean {
    return this.text === other.text;
  }
}

/** Strip wrapping markers from inline markup. */
function stripMarkers(raw: string, type: string): string {
  switch (type) {
    case "StrongEmphasis":
      return raw.replace(/^(\*\*|__)(.*)\1$/s, "$2");
    case "Emphasis":
      return raw.replace(/^(\*|_)(.*)\1$/s, "$2");
    case "InlineCode":
      return raw.replace(/^`(.*)`$/s, "$1");
    default:
      return raw;
  }
}

/** Map from node type to widget constructor. */
const WIDGET_MAP: Record<string, new (text: string) => RenderWidget> = {
  StrongEmphasis: BoldWidget,
  Emphasis: ItalicWidget,
  InlineCode: InlineCodeWidget,
};

/** Collect decoration ranges for inline elements outside the cursor. */
export function collectInlineRanges(view: EditorView): Range<Decoration>[] {
  const nodes = collectNodes(view, INLINE_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (cursorInRange(view, node.from, node.to)) continue;

    const raw = view.state.sliceDoc(node.from, node.to);
    const text = stripMarkers(raw, node.type);
    const Widget = WIDGET_MAP[node.type];
    if (Widget) {
      const widget = new Widget(text);
      items.push(
        Decoration.replace({ widget }).range(node.from, node.to),
      );
    }
  }

  return items;
}

/** Build a DecorationSet for inline elements (convenience wrapper). */
export function inlineDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectInlineRanges(view));
}
