import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type EditorState, type Extension, type Range, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/**
 * Check whether the primary cursor is contained within [from, to].
 *
 * Uses containment (cursor.from >= from && cursor.to <= to) rather than
 * overlap so that clicking *near* a widget places the cursor outside the
 * replaced range and keeps the widget rendered.
 */
export function cursorInRange(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  if (!view.hasFocus) return false;
  const cursor = view.state.selection.main;
  return cursor.from >= from && cursor.to <= to;
}

/**
 * Check whether the primary cursor is contained within [from, to]
 * using only EditorState (no view/focus check).
 */
export function cursorContainedIn(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const cursor = state.selection.main;
  return cursor.from >= from && cursor.to <= to;
}

/** Result of collecting renderable nodes from the syntax tree. */
export interface RenderableNode {
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Walk the syntax tree and collect nodes matching the given type names.
 * Accepts either an EditorView or EditorState.
 */
export function collectNodes(
  viewOrState: EditorView | EditorState,
  types: ReadonlySet<string>,
): RenderableNode[] {
  const state = "state" in viewOrState ? viewOrState.state : viewOrState;
  const results: RenderableNode[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (types.has(node.type.name)) {
        results.push({
          type: node.type.name,
          from: node.from,
          to: node.to,
        });
      }
    },
  });
  return results;
}

/**
 * Build a DecorationSet from an array of decoration ranges.
 * Sorts by position before building (RangeSetBuilder requires sorted input).
 */
export function buildDecorations(
  items: ReadonlyArray<Range<Decoration>>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of sorted) {
    builder.add(item.from, item.to, item.value);
  }
  return builder.finish();
}

/**
 * Base class for render widgets.
 *
 * Subclasses implement `createDOM()` to build the widget element.
 * `toDOM(view)` attaches a mousedown handler that moves the cursor
 * inside the replaced range when clicked — necessary because CM6
 * places cursor at the boundary of Decoration.replace, not inside.
 *
 * Set `sourceFrom` before the widget is added to a decoration.
 */
export abstract class RenderWidget extends WidgetType {
  /** Document offset of the start of the source range this widget replaces. */
  sourceFrom = -1;

  /** Subclasses build their DOM element here. */
  abstract createDOM(): HTMLElement;

  toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    if (this.sourceFrom >= 0 && view) {
      el.style.cursor = "pointer";
      const from = this.sourceFrom;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        // Focus first so the focus state field is updated before
        // the selection dispatch triggers decoration rebuilding.
        view.focus();
        view.dispatch({ selection: { anchor: from } });
      });
    }
    return el;
  }

  /**
   * Return true so CM6 does NOT also process mouse events on this widget.
   * Our mousedown handler in toDOM() handles cursor placement exclusively.
   * If CM6 also processes the event, it places cursor at the widget boundary
   * (outside the replaced range), overriding our handler.
   */
  ignoreEvent(): boolean {
    return true;
  }
}

/** StateEffect dispatched when the editor gains or loses focus. */
export const focusEffect = StateEffect.define<boolean>();

/**
 * Shared StateField that tracks whether the editor is focused.
 *
 * Used by StateField-based renderers (math, block plugins) that need
 * to know focus state to decide whether to show source or rendered view.
 */
export const editorFocusField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(focused, tr) {
    for (const effect of tr.effects) {
      if (effect.is(focusEffect)) return effect.value;
    }
    return focused;
  },
});

/**
 * Extension that dispatches focus-change effects when the editor
 * gains or loses focus.
 */
export const focusTracker: Extension = EditorView.domEventHandlers({
  focus(_event, view) {
    view.dispatch({ effects: focusEffect.of(true) });
  },
  blur(_event, view) {
    view.dispatch({ effects: focusEffect.of(false) });
  },
});
