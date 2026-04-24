import {
  type EditorState,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  type Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { createChangeChecker } from "../state/change-detection";
import { focusEffect } from "./focus-state";
import { measureSync } from "../lib/perf";
import {
  type DecorationLifecycleContext,
  type DecorationRangeBounds,
  hasProgrammaticDocumentRewrite,
  planDecorationLifecycleUpdate,
  removeDecorationsInRanges,
} from "./decoration-lifecycle";

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

export type DecorationStateFieldDirtyRangeFn<
  T extends DecorationRangeBounds,
> = (
  tr: Transaction,
  context: DecorationLifecycleContext,
) => readonly T[] | null;

export function createLifecycleDecorationStateField<
  T extends DecorationRangeBounds = DecorationRangeBounds,
>(options: {
  build: (state: EditorState) => DecorationSet;
  collectRanges: (state: EditorState, dirtyRanges: readonly T[]) => Range<Decoration>[];
  semanticChanged?: (beforeState: EditorState, afterState: EditorState) => boolean;
  contextChanged?: (tr: Transaction) => boolean;
  dirtyRangeFn?: DecorationStateFieldDirtyRangeFn<T>;
  shouldRebuild?: (
    tr: Transaction,
    context: DecorationLifecycleContext,
  ) => boolean;
  mapDecorations?: (
    decorations: DecorationSet,
    tr: Transaction,
  ) => DecorationSet;
  stableDocChangeMode?: "keep" | "map";
  contextUpdateMode?: "rebuild" | "dirty-ranges";
  spanName?: string;
}): StateField<DecorationSet> {
  const mapDecorations = options.mapDecorations
    ?? ((decorations: DecorationSet, tr: Transaction) => (
      tr.docChanged ? decorations.map(tr.changes) : decorations
    ));

  return createDecorationStateField({
    spanName: options.spanName,
    create(state) {
      return options.build(state);
    },
    update(value, tr) {
      const plan = planDecorationLifecycleUpdate(tr, {
        docChanged: (current) => current.docChanged,
        semanticChanged: options.semanticChanged
          ? (current) => options.semanticChanged?.(current.startState, current.state) ?? false
          : undefined,
        contextChanged: options.contextChanged,
        programmaticRewrite: hasProgrammaticDocumentRewrite,
        shouldRebuild: options.shouldRebuild,
        dirtyRanges: options.dirtyRangeFn,
        stableDocChangeMode: options.stableDocChangeMode,
        contextUpdateMode: options.contextUpdateMode,
      });

      switch (plan.kind) {
        case "keep":
          return value;
        case "map":
          return mapDecorations(value, tr);
        case "rebuild":
          return options.build(tr.state);
        case "dirty": {
          const mappedValue = mapDecorations(value, tr);
          const nextValue = removeDecorationsInRanges(mappedValue, plan.dirtyRanges);
          const items = options.collectRanges(tr.state, plan.dirtyRanges);
          if (items.length === 0) return nextValue;
          return nextValue.update({ add: items, sort: true });
        }
      }
    },
  });
}
