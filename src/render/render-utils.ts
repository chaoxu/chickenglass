import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type StateEffectType,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/**
 * Check whether the primary cursor is contained within [from, to].
 *
 * Accepts either an EditorView or EditorState:
 * - EditorView: also checks view.hasFocus (returns false when unfocused)
 * - EditorState: pure position check with no focus guard
 *
 * Uses containment (cursor.from >= from && cursor.to <= to) rather than
 * overlap so that clicking *near* a widget places the cursor outside the
 * replaced range and keeps the widget rendered.
 */
export function cursorInRange(
  viewOrState: EditorView | EditorState,
  from: number,
  to: number,
): boolean {
  if ("state" in viewOrState) {
    // EditorView path — guard on focus
    if (!viewOrState.hasFocus) return false;
    const cursor = viewOrState.state.selection.main;
    return cursor.from >= from && cursor.to <= to;
  }
  // EditorState path — no focus guard
  const cursor = viewOrState.selection.main;
  return cursor.from >= from && cursor.to <= to;
}

/**
 * @deprecated Use `cursorInRange` which now accepts both EditorView and EditorState.
 */

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
 * Serialize macros to a stable string for use in widget equality checks.
 * Returns an empty string when there are no macros.
 */
export function serializeMacros(macros: Record<string, string>): string {
  const keys = Object.keys(macros);
  if (keys.length === 0) return "";
  keys.sort();
  return keys.map((k) => `${k}=${macros[k]}`).join("\0");
}

/** Shared Decoration.mark that visually hides source markers via CSS while keeping them in the DOM. */
export const decorationHidden = Decoration.mark({ class: "cf-hidden" });

/**
 * Heading-like marker replacement pattern.
 *
 * Both ATX headings and fenced div block headers follow the same principle:
 *
 *   1. A syntactic marker (# or ::: {.class}) is hidden/replaced when cursor is outside.
 *   2. Content text AFTER the marker stays as normal editable document content.
 *   3. Inline render plugins (math, bold, italic) handle the content naturally.
 *   4. When cursor enters the marker area, the marker becomes source.
 *
 * THIS IS CRITICAL — DO NOT "simplify" by replacing the full line with a single widget.
 * Doing so kills inline rendering of content text (e.g., $x^2$ won't render as KaTeX
 * in source mode). This has regressed 3+ times. See CLAUDE.md "Block headers must
 * behave like headings."
 *
 * @param markerFrom  Start of syntactic marker (# position, or ::: position)
 * @param markerTo    End of marker (before content text, e.g., titleFrom or openFenceTo)
 * @param cursorInside  True when cursor is in the marker's "source zone" (marker stays visible)
 * @param widget      Widget to show when marker is hidden. Null = hide without replacement (headings).
 *                    Widget must extend RenderWidget (sourceFrom will be set automatically).
 * @param items       Decoration range accumulator
 */
export function addMarkerReplacement(
  markerFrom: number,
  markerTo: number,
  cursorInside: boolean,
  widget: RenderWidget | null,
  items: Range<Decoration>[],
): void {
  if (cursorInside) return; // marker visible as source — nothing to replace
  if (markerFrom >= markerTo) return; // degenerate range

  if (widget) {
    widget.sourceFrom = markerFrom;
    items.push(Decoration.replace({ widget }).range(markerFrom, markerTo));
  } else {
    items.push(decorationHidden.range(markerFrom, markerTo));
  }
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

  /**
   * Subclasses build their DOM element here.
   *
   * Called by the default `toDOM()` implementation. Widgets that override
   * `toDOM()` entirely (e.g. widgets needing the view parameter for custom
   * event handling) do not need to implement this method.
   */
  createDOM(): HTMLElement {
    return document.createElement("span");
  }

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
 * Build a boolean StateField controlled solely by a matching StateEffect.
 *
 * The field preserves its previous value unless the transaction contains the
 * given effect, in which case it adopts the effect's boolean payload.
 */
export function createBooleanToggleField(
  effect: StateEffectType<boolean>,
  initialValue = false,
): StateField<boolean> {
  return StateField.define<boolean>({
    create() {
      return initialValue;
    },
    update(value, tr) {
      for (const candidate of tr.effects) {
        if (candidate.is(effect)) return candidate.value;
      }
      return value;
    },
  });
}

/**
 * Shared StateField that tracks whether the editor is focused.
 *
 * Used by StateField-based renderers (math, block plugins) that need
 * to know focus state to decide whether to show source or rendered view.
 */
export const editorFocusField = createBooleanToggleField(focusEffect);

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
