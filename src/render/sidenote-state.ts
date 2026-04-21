import { StateEffect, StateField } from "@codemirror/state";
import { createBooleanToggleField } from "./focus-state";

/** StateEffect to toggle sidenote margin visibility. */
export const sidenotesCollapsedEffect = StateEffect.define<boolean>();

/** StateField tracking whether the sidenote margin is collapsed. */
export const sidenotesCollapsedField = createBooleanToggleField(sidenotesCollapsedEffect);

/** StateEffect to toggle inline expansion of a footnote ref. */
export const footnoteInlineToggleEffect = StateEffect.define<{
  id: string;
  expanded: boolean;
}>();

/**
 * StateField tracking which footnote IDs are currently expanded inline.
 *
 * When a user clicks a footnote ref in collapsed-sidenotes mode, the
 * definition content appears inline below the ref line instead of scrolling
 * to the definition. This keeps the user in reading context.
 */
export const footnoteInlineExpandedField = StateField.define<ReadonlySet<string>>({
  create() {
    return new Set<string>();
  },
  update(value, tr) {
    let changed = false;
    let next: Set<string> | undefined;
    for (const effect of tr.effects) {
      if (effect.is(footnoteInlineToggleEffect)) {
        if (!next) next = new Set(value);
        if (effect.value.expanded) {
          next.add(effect.value.id);
        } else {
          next.delete(effect.value.id);
        }
        changed = true;
      }
    }
    return changed && next ? next : value;
  },
  compare(a, b) {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const id of a) {
      if (!b.has(id)) return false;
    }
    return true;
  },
});
