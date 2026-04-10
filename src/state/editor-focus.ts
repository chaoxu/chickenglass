import {
  StateEffect,
  StateField,
  type StateEffectType,
} from "@codemirror/state";

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
 * Used by both editor and render modules that need to decide whether to show
 * source or rendered view.
 */
export const editorFocusField = createBooleanToggleField(focusEffect);
