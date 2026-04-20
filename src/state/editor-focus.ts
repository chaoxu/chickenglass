import {
  StateEffect,
  StateField,
  type StateEffectType,
} from "@codemirror/state";

export type FocusOwnerRole =
  | "embedded-field"
  | "rich-surface"
  | "source-bridge"
  | "source-surface";

export type FocusOwner =
  | { readonly kind: "none" }
  | {
      readonly kind: "surface";
      readonly namespace: string;
      readonly role: FocusOwnerRole;
    };

export type SurfaceFocusOwner = Extract<FocusOwner, { readonly kind: "surface" }>;

export const FOCUS_NONE: FocusOwner = { kind: "none" };

export function focusSurface(
  role: FocusOwnerRole,
  namespace: string,
): SurfaceFocusOwner {
  return {
    kind: "surface",
    namespace,
    role,
  };
}

export function isSameFocusOwner(
  a: FocusOwner,
  b: FocusOwner,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "surface" && b.kind === "surface") {
    return a.namespace === b.namespace && a.role === b.role;
  }
  return true;
}

export function setFocusOwner(
  current: FocusOwner,
  next: FocusOwner,
): FocusOwner {
  return isSameFocusOwner(current, next) ? current : next;
}

export function clearFocusOwner(
  current: FocusOwner,
): FocusOwner {
  return current.kind === "none" ? current : FOCUS_NONE;
}

export function clearFocusOwnerIfMatch(
  current: FocusOwner,
  next: FocusOwner,
): FocusOwner {
  return isSameFocusOwner(current, next) ? clearFocusOwner(current) : current;
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
 * Used by both editor and render modules that need to decide whether to show
 * source or rendered view.
 */
export const editorFocusField = createBooleanToggleField(focusEffect);
