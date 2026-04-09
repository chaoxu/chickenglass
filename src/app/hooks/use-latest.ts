import { useRef } from "react";

/** Keep a ref always pointing at the latest value without an effect. */
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
