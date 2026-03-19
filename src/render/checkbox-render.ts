/**
 * Checkbox rendering for GFM task lists.
 *
 * Replaces TaskMarker nodes ([ ] or [x]) with interactive checkbox
 * widgets when the cursor is NOT on the same line. Clicking the
 * checkbox toggles the document content between [ ] and [x].
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { cursorInRange, RenderWidget } from "./render-utils";

/** Checkbox widget that toggles task marker content on click. */
class CheckboxWidget extends RenderWidget {
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
    return this.checked === other.checked && this.from === other.from;
  }
}

class CheckboxRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.process(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.decorations = this.process(update.view);
    }
  }

  private process(view: EditorView): DecorationSet {
    const widgets: Range<Decoration>[] = [];

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter(node) {
          if (node.name !== "TaskMarker") return;

          // Show source only when cursor touches the marker itself
          if (cursorInRange(view, node.from, node.to)) return;

          const text = view.state.sliceDoc(node.from, node.to);
          const checked = text.includes("x") || text.includes("X");

          widgets.push(
            Decoration.replace({
              widget: new CheckboxWidget(checked, node.from, node.to),
            }).range(node.from, node.to),
          );
        },
      });
    }

    return Decoration.set(widgets, true);
  }
}

/** CM6 extension that renders task list checkboxes with toggle support. */
export const checkboxRenderPlugin: Extension = ViewPlugin.fromClass(
  CheckboxRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
