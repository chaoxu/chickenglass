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
  type ViewUpdate,
} from "@codemirror/view";
import {
  type Extension,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  pushWidgetDecoration,
} from "./decoration-core";
import {
  createIncrementalDecorationsViewPlugin,
} from "./view-plugin-factories";
import { normalizeDirtyRange, type VisibleRange } from "./viewport-diff";
import { RenderWidget } from "./source-widget";

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

function collectCheckboxItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
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
  return items;
}

function buildCheckboxDecorations(view: EditorView): DecorationSet {
  const items = collectCheckboxItems(view, view.visibleRanges);
  return buildDecorations(items);
}

function collectTaskMarkerDirtyRangesInState(
  state: EditorView["state"],
  from: number,
  to: number,
  push: (from: number, to: number) => void,
): void {
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "TaskMarker") return;
      push(node.from, node.to);
    },
  });
}

function computeCheckboxDocChangeRanges(update: ViewUpdate): readonly VisibleRange[] {
  const dirtyRanges: VisibleRange[] = [];
  const pushMappedRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, update.state.doc.length));
  };

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    syntaxTree(update.startState).iterate({
      from: fromA,
      to: toA,
      enter(node) {
        if (node.name !== "TaskMarker") return;
        pushMappedRange(
          update.changes.mapPos(node.from, 1),
          update.changes.mapPos(node.to, -1),
        );
      },
    });
    collectTaskMarkerDirtyRangesInState(update.state, fromB, toB, pushMappedRange);
  });

  return dirtyRanges;
}

/** CM6 extension that renders task list checkboxes with toggle support. */
export const checkboxRenderPlugin: Extension = createIncrementalDecorationsViewPlugin(
  buildCheckboxDecorations,
  {
    incrementalRanges: computeCheckboxDocChangeRanges,
    collectRanges: collectCheckboxItems,
    shouldRebuild(update) {
      return !update.docChanged
        && syntaxTree(update.state) !== syntaxTree(update.startState);
    },
  },
);
