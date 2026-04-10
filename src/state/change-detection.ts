import { syntaxTree } from "@codemirror/language";
import type {
  EditorState,
  Transaction,
} from "@codemirror/state";

export interface ChangeCheckerOptions {
  readonly doc?: boolean;
  readonly tree?: boolean;
}

export interface StateValueSelector<T> {
  readonly get: (state: EditorState) => T;
  readonly equals?: (before: T, after: T) => boolean;
}

export interface ChangeChecker {
  (tr: Transaction): boolean;
  (beforeState: EditorState, afterState: EditorState): boolean;
}

type StateValueSelectorLike<T> = StateValueSelector<T> | ((state: EditorState) => T);
type StateValueSelectorTuple<T extends readonly unknown[]> = {
  [K in keyof T]: StateValueSelectorLike<T[K]>;
};

function isChangeCheckerOptions(value: unknown): value is ChangeCheckerOptions {
  return typeof value === "object"
    && value !== null
    && !("get" in value);
}

function normalizeStateValueSelector<T>(
  selector: StateValueSelectorLike<T>,
): StateValueSelector<T> {
  return typeof selector === "function" ? { get: selector } : selector;
}

function selectedStateValuesChanged(
  beforeState: EditorState,
  afterState: EditorState,
  selectors: readonly StateValueSelectorLike<unknown>[],
): boolean {
  for (const selectorLike of selectors) {
    const selector = normalizeStateValueSelector(selectorLike);
    const before = selector.get(beforeState);
    const after = selector.get(afterState);
    if (!(selector.equals ?? Object.is)(before, after)) {
      return true;
    }
  }
  return false;
}

function statePairChanged(
  beforeState: EditorState,
  afterState: EditorState,
  options: ChangeCheckerOptions,
  selectors: readonly StateValueSelectorLike<unknown>[],
  docChanged: boolean,
): boolean {
  if (options.doc && docChanged) return true;
  if (options.tree && syntaxTree(afterState) !== syntaxTree(beforeState)) {
    return true;
  }
  return selectedStateValuesChanged(beforeState, afterState, selectors);
}

export function createChangeChecker<T extends readonly unknown[]>(
  ...selectors: StateValueSelectorTuple<T>
): ChangeChecker;
export function createChangeChecker<T extends readonly unknown[]>(
  options: ChangeCheckerOptions,
  ...selectors: StateValueSelectorTuple<T>
): ChangeChecker;
export function createChangeChecker(
  optionsOrSelector?: ChangeCheckerOptions | StateValueSelectorLike<unknown>,
  ...restSelectors: readonly StateValueSelectorLike<unknown>[]
): ChangeChecker {
  const options = isChangeCheckerOptions(optionsOrSelector) ? optionsOrSelector : {};
  const selectors = optionsOrSelector === undefined
    ? restSelectors
    : isChangeCheckerOptions(optionsOrSelector)
      ? restSelectors
      : [optionsOrSelector, ...restSelectors];

  return ((first: Transaction | EditorState, second?: EditorState) => {
    if (second !== undefined) {
      const beforeState = first as EditorState;
      return statePairChanged(
        beforeState,
        second,
        options,
        selectors,
        options.doc ? !beforeState.doc.eq(second.doc) : false,
      );
    }

    const tr = first as Transaction;
    return statePairChanged(
      tr.startState,
      tr.state,
      options,
      selectors,
      tr.docChanged,
    );
  }) as ChangeChecker;
}
