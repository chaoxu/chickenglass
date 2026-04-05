/**
 * Checkbox rendering for GFM task lists.
 *
 * Replaces TaskMarker nodes ([ ] or [x]) with interactive checkbox
 * widgets when the cursor is NOT on the same line. Clicking the
 * checkbox toggles the document content between [ ] and [x].
 */

import {
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
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

/**
 * Only TaskMarker boundaries matter here: checkbox widgets are hidden when the
 * selection is inside a TaskMarker, so tracking the parent Task would rebuild
 * unnecessarily while the cursor moves through task text.
 */
function checkboxCursorContextKey(state: EditorState): string {
  const { from, to } = state.selection.main;
  const tree = syntaxTree(state);
  const seen = new Set<string>();
  const positions = from === to ? [from] : [from, to];

  for (const pos of positions) {
    const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(clampedPos, side);
      while (true) {
        if (node.name === "TaskMarker" && from >= node.from && to <= node.to) {
          seen.add(`TaskMarker:${node.from}:${node.to}`);
          break;
        }
        const parent = node.parent;
        if (!parent) break;
        node = parent;
      }
    }
  }

  if (seen.size === 0) return "";
  if (seen.size === 1) return seen.values().next().value!;
  return [...seen].sort().join("|");
}

function checkboxCursorContextChanged(update: ViewUpdate): boolean {
  return checkboxCursorContextKey(update.state) !== checkboxCursorContextKey(update.startState);
}

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
  {
    selectionCheck: checkboxCursorContextChanged,
  },
);
