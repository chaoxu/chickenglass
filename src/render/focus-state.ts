import {
  type Extension,
  StateEffect,
  StateField,
  type StateEffectType,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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
 * Used by StateField-based renderers that need to know focus state to decide
 * whether to show source or rendered view.
 */
export const editorFocusField = createBooleanToggleField(focusEffect);

/**
 * Extension that dispatches focus-change effects when the editor gains or loses focus.
 */
export const focusTracker: Extension = EditorView.focusChangeEffect.of(
  (_state, focusing) => focusEffect.of(focusing),
);
