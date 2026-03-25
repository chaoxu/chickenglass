// Type declarations for zustand v5 — required because the package's
// exports map uses .d.mts files that TS can't always resolve.
declare module "zustand" {
  type SetState<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>)) => void;
  type GetState<T> = () => T;
  type StoreApi<T> = { getState: GetState<T>; setState: SetState<T>; subscribe: (listener: (state: T, prevState: T) => void) => () => void };

  export function create<T>(): (initializer: (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T) => { (): T; <U>(selector: (state: T) => U): U; getState: GetState<T>; setState: SetState<T>; subscribe: (listener: (state: T, prevState: T) => void) => () => void };

  export function useStore<T, U>(store: StoreApi<T>, selector: (state: T) => U): U;
}
