/**
 * Lexical-native change detection utility. Equivalent of coflat v1's
 * createChangeChecker, adapted for Lexical's update-listener model.
 *
 * Lexical does not have CM6-style transactions with explicit startState/state
 * pairs. Instead, update listeners receive the current editor state and tags.
 * This module provides composable change checkers that compare snapshots of
 * derived values to decide whether a meaningful change occurred.
 */

/**
 * A selector that extracts a value from a state snapshot. The `equals`
 * function defaults to `Object.is` (reference equality) when not provided.
 */
export interface StateValueSelector<TState, TValue> {
  readonly get: (state: TState) => TValue;
  readonly equals?: (before: TValue, after: TValue) => boolean;
}

/**
 * A function that returns true if the state change is relevant.
 */
export type ChangeChecker<TState> = (before: TState, after: TState) => boolean;

/**
 * Accepted input for createChangeChecker: either a full selector object
 * (with optional custom equality) or a bare function selector.
 *
 * When passing a StateValueSelector, the `equals` callback is typed relative
 * to the selector's own `get` return type at the call site. Once stored in
 * the heterogeneous array, the value type is erased — `any` is required here
 * because `unknown` would prevent passing typed StateValueSelector objects.
 */
// biome-ignore lint/suspicious/noExplicitAny: existential type erasure for heterogeneous selector array
export type SelectorLike<TState> = StateValueSelector<TState, any> | ((state: TState) => unknown);

function normalizeSelector<TState>(
  selector: SelectorLike<TState>,
): StateValueSelector<TState, unknown> {
  return typeof selector === "function" ? { get: selector } : selector;
}

/**
 * Creates a change checker that returns true when any of the given selectors
 * produce a different value between the before and after states.
 *
 * Usage with simple selectors (functions):
 * ```ts
 * const checker = createChangeChecker<MyState>(
 *   (state) => state.focus.kind,
 *   (state) => state.structureEdit.status,
 * );
 * if (checker(prevState, nextState)) {
 *   // something relevant changed
 * }
 * ```
 *
 * Usage with custom equality:
 * ```ts
 * const checker = createChangeChecker<MyState>({
 *   get: (state) => state.matches,
 *   equals: (a, b) => a.length === b.length,
 * });
 * ```
 */
export function createChangeChecker<TState>(
  ...selectors: readonly SelectorLike<TState>[]
): ChangeChecker<TState> {
  const normalized = selectors.map((s) => normalizeSelector(s));

  return (before: TState, after: TState): boolean => {
    for (const selector of normalized) {
      const beforeValue = selector.get(before);
      const afterValue = selector.get(after);
      if (!(selector.equals ?? Object.is)(beforeValue, afterValue)) {
        return true;
      }
    }
    return false;
  };
}
