import { useRef } from "react";

/**
 * Keep a ref always pointing at the latest value without an effect.
 *
 * The render-time assignment is intentional: these callers need fresh values
 * in stable callbacks without scheduling a follow-up sync effect.
 */
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
