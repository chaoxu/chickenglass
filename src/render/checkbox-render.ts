/**
 * Checkbox rendering for GFM task lists.
 *
 * Replaces TaskMarker nodes ([ ] or [x]) with interactive checkbox
 * widgets when the cursor is NOT on the same line. Clicking the
 * checkbox toggles the document content between [ ] and [x].
 */

import {
  type EditorView,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import {
  type VisibleRange,
  collectNodeRangesExcludingCursor,
  createCursorSensitiveViewPlugin,
  pushWidgetDecoration,
  RenderWidget,
} from "./render-utils";

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

const TASK_MARKER_TYPES = new Set(["TaskMarker"]);

/** Collect checkbox decoration ranges for task list markers. */
function collectCheckboxItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
) {
  return collectNodeRangesExcludingCursor(view, TASK_MARKER_TYPES, (node, items) => {
    const text = view.state.sliceDoc(node.from, node.to);
    const checked = text.includes("x") || text.includes("X");

    pushWidgetDecoration(items, new CheckboxWidget(checked, node.from, node.to), node.from, node.to);
  }, { ranges, skip });
}

/** CM6 extension that renders task list checkboxes with toggle support. */
export const checkboxRenderPlugin: Extension = createCursorSensitiveViewPlugin(
  collectCheckboxItems,
);
