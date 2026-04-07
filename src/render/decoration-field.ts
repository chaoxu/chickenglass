import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { focusEffect } from "./focus-state";

/**
 * Default rebuild predicate for StateField-based decoration providers.
 *
 * Returns true only for structural changes: docChanged or syntaxTree changed.
 */
export function defaultShouldRebuild(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
  );
}

/**
 * Cursor-sensitive rebuild predicate for StateField-based decoration providers.
 *
 * Returns true for structural changes plus selection changes and focusEffect.
 */
export function cursorSensitiveShouldRebuild(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((effect) => effect.is(focusEffect)) ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
  );
}

/**
 * Factory that creates a CM6 StateField providing DecorationSet.
 */
export function createDecorationsField(
  builder: (state: EditorState) => DecorationSet,
  shouldRebuild?: (tr: Transaction) => boolean,
  mapOnDocChanged?: boolean,
): StateField<DecorationSet> {
  const predicate = shouldRebuild ?? defaultShouldRebuild;

  return StateField.define<DecorationSet>({
    create(state) {
      return builder(state);
    },

    update(value, tr) {
      if (predicate(tr)) {
        return builder(tr.state);
      }
      if (mapOnDocChanged && tr.docChanged) {
        return value.map(tr.changes);
      }
      return value;
    },

    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}
