/**
 * Checkbox rendering for GFM task lists.
 *
 * Replaces TaskMarker nodes ([ ] or [x]) with interactive checkbox
 * widgets. Task markers stay rendered as widgets during ordinary
 * navigation; clicking the checkbox toggles the document content
 * between [ ] and [x].
 */

import {
  type Decoration,
  type EditorView,
  type DecorationSet,
} from "@codemirror/view";
import {
  type Extension,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { buildDecorations, pushWidgetDecoration } from "./decoration-core";
import { createSimpleViewPlugin } from "./view-plugin-factories";
import { RenderWidget } from "./widget-core";

/** Checkbox widget that toggles task marker content on click. */
export class CheckboxWidget extends RenderWidget {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Completed task" : "Incomplete task");
    input.style.cursor = "pointer";
    input.style.verticalAlign = "middle";
    input.style.marginRight = "4px";

    const from = this.from;
    const to = this.to;
    const checked = this.checked;

    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const replacement = checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from, to, insert: replacement },
      });
    });

    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }
}

function buildCheckboxDecorations(view: EditorView): DecorationSet {
  const items: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "TaskMarker" || seen.has(node.from)) return;
        seen.add(node.from);
        const text = view.state.sliceDoc(node.from, node.to);
        const checked = text.includes("x") || text.includes("X");
        pushWidgetDecoration(
          items,
          new CheckboxWidget(checked, node.from, node.to),
          node.from,
          node.to,
        );
      },
    });
  }
  return buildDecorations(items);
}

/** CM6 extension that renders task list checkboxes with toggle support. */
export const checkboxRenderPlugin: Extension = createSimpleViewPlugin(
  buildCheckboxDecorations,
);
