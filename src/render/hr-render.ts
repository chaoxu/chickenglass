import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import {
  cursorInRange,
  collectNodes,
  buildDecorations,
  RenderWidget,
} from "./render-utils";

const HR_TYPES = new Set(["HorizontalRule"]);

/** Widget that renders a horizontal rule. */
export class HorizontalRuleWidget extends RenderWidget {
  createDOM(): HTMLElement {
    const el = document.createElement("hr");
    el.className = "cg-hr";
    return el;
  }

  eq(_other: HorizontalRuleWidget): boolean {
    return true;
  }
}

/** Collect decoration ranges for horizontal rules outside the cursor. */
export function collectHrRanges(view: EditorView): Range<Decoration>[] {
  const nodes = collectNodes(view, HR_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (cursorInRange(view, node.from, node.to)) continue;

    const widget = new HorizontalRuleWidget();
    widget.sourceFrom = node.from;
    items.push(
      Decoration.replace({ widget }).range(node.from, node.to),
    );
  }

  return items;
}

/** Build a DecorationSet for horizontal rules (convenience wrapper). */
export function hrDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectHrRanges(view));
}
