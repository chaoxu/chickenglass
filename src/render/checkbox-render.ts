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
  type Transaction,
} from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  pushWidgetDecoration,
} from "./decoration-core";
import {
  createLifecycleDecorationStateField,
} from "./decoration-field";
import { normalizeDirtyRange, type VisibleRange } from "./viewport-diff";
import { RenderWidget } from "./source-widget";

const CHECKBOX_LAYOUT_PARSE_TIMEOUT_MS = 1000;

function checkboxLayoutTree(state: EditorView["state"]) {
  return ensureSyntaxTree(
    state,
    state.doc.length,
    CHECKBOX_LAYOUT_PARSE_TIMEOUT_MS,
  ) ?? syntaxTree(state);
}

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

function collectCheckboxItemsFromState(
  state: EditorView["state"],
  ranges: readonly VisibleRange[],
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
    checkboxLayoutTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "TaskMarker" || seen.has(node.from)) return;
        seen.add(node.from);
        const text = state.sliceDoc(node.from, node.to);
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

function collectCheckboxItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
): Range<Decoration>[] {
  return collectCheckboxItemsFromState(view.state, ranges);
}

function buildCheckboxDecorationsFromState(state: EditorView["state"]): DecorationSet {
  const items = collectCheckboxItemsFromState(state, [{ from: 0, to: state.doc.length }]);
  return buildDecorations(items);
}

function collectTaskMarkerDirtyRangesInState(
  state: EditorView["state"],
  from: number,
  to: number,
  push: (from: number, to: number) => void,
): void {
  checkboxLayoutTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "TaskMarker") return;
      push(node.from, node.to);
    },
  });
}

function computeCheckboxDocChangeRanges(tr: Transaction): readonly VisibleRange[] {
  const dirtyRanges: VisibleRange[] = [];
  const pushMappedRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, tr.state.doc.length));
  };

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    syntaxTree(tr.startState).iterate({
      from: fromA,
      to: toA,
      enter(node) {
        if (node.name !== "TaskMarker") return;
        pushMappedRange(
          tr.changes.mapPos(node.from, 1),
          tr.changes.mapPos(node.to, -1),
        );
      },
    });
    collectTaskMarkerDirtyRangesInState(tr.state, fromB, toB, pushMappedRange);
  });

  return dirtyRanges;
}

/** CM6 extension that renders task list checkboxes with toggle support. */
const checkboxDecorationField = createLifecycleDecorationStateField({
  spanName: "cm6.checkboxRender",
  build: buildCheckboxDecorationsFromState,
  collectRanges: collectCheckboxItemsFromState,
  semanticChanged(beforeState, afterState) {
    return syntaxTree(afterState) !== syntaxTree(beforeState);
  },
  shouldRebuild(_tr, context) {
    return context.docChanged || (!context.docChanged && context.semanticChanged);
  },
  dirtyRangeFn(tr) {
    return computeCheckboxDocChangeRanges(tr);
  },
});

/** CM6 extension that renders task list checkboxes with toggle support. */
export const checkboxRenderPlugin: Extension = checkboxDecorationField;

export { collectCheckboxItems as _collectCheckboxItemsForTest };
export { checkboxDecorationField as _checkboxDecorationFieldForTest };
