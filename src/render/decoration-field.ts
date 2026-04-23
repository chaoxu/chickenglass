import {
  type EditorState,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { createChangeChecker } from "../state/change-detection";
import { focusEffect } from "./focus-state";
import { measureSync } from "../lib/perf";

const structuralChangeDetected = createChangeChecker({ doc: true, tree: true });

/**
 * Default rebuild predicate for StateField-based decoration providers.
 *
 * Returns true only for structural changes: docChanged or syntaxTree changed.
 */
export function defaultShouldRebuild(tr: Transaction): boolean {
  return structuralChangeDetected(tr);
}

/**
 * Cursor-sensitive rebuild predicate for StateField-based decoration providers.
 *
 * Returns true for structural changes plus selection changes and focusEffect.
 */
export function cursorSensitiveShouldRebuild(tr: Transaction): boolean {
  return (
    defaultShouldRebuild(tr) ||
    tr.selection !== undefined ||
    tr.effects.some((effect) => effect.is(focusEffect))
  );
}

/**
 * Factory that creates a CM6 StateField providing DecorationSet from
 * explicit create/update handlers.
 */
export function createDecorationStateField(options: {
  create: (state: EditorState) => DecorationSet;
  update: (value: DecorationSet, tr: Transaction) => DecorationSet;
  spanName?: string;
}): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return options.spanName
        ? measureSync(`${options.spanName}.create`, () => options.create(state))
        : options.create(state);
    },
    update(value, tr) {
      return options.spanName
        ? measureSync(`${options.spanName}.update`, () => options.update(value, tr))
        : options.update(value, tr);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

/**
 * Factory that creates a CM6 StateField providing DecorationSet.
 */
export function createDecorationsField(
  builder: (state: EditorState) => DecorationSet,
  shouldRebuild?: (tr: Transaction) => boolean,
  mapOnDocChanged?: boolean,
  spanName?: string,
): StateField<DecorationSet> {
  const predicate = shouldRebuild ?? defaultShouldRebuild;

  return createDecorationStateField({
    spanName,
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
  });
}
