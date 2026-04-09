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

export function createChangeChecker<T extends readonly unknown[]>(
  ...selectors: StateValueSelectorTuple<T>
): (tr: Transaction) => boolean;
export function createChangeChecker<T extends readonly unknown[]>(
  options: ChangeCheckerOptions,
  ...selectors: StateValueSelectorTuple<T>
): (tr: Transaction) => boolean;
export function createChangeChecker(
  optionsOrSelector?: ChangeCheckerOptions | StateValueSelectorLike<unknown>,
  ...restSelectors: readonly StateValueSelectorLike<unknown>[]
): (tr: Transaction) => boolean {
  const options = isChangeCheckerOptions(optionsOrSelector) ? optionsOrSelector : {};
  const selectors = optionsOrSelector === undefined
    ? restSelectors
    : isChangeCheckerOptions(optionsOrSelector)
      ? restSelectors
      : [optionsOrSelector, ...restSelectors];

  return (tr) => {
    if (options.doc && tr.docChanged) return true;
    if (options.tree && syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return true;
    }
    return selectedStateValuesChanged(tr.startState, tr.state, selectors);
  };
}
