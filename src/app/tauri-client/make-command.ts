/**
 * Typed factory for Tauri command wrappers.
 *
 * Each Rust command name appears exactly once as the first argument, making
 * it easy to audit TS bindings against the Rust `generate_handler!` list.
 *
 * Usage:
 *   tauriCommand<ReturnType>("command_name")                     // no-arg
 *   tauriArgs<ReturnType>("command_name")((a, b) => ({ a, b }))  // with args
 */

import { measureAsync } from "../../lib/perf";
import { invokeTauriCommandRaw } from "./core";

function invokeTauriCommandWithPerf<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return measureAsync(`tauri.invoke.${command}`, async () => {
    return invokeTauriCommandRaw<T>(command, args);
  }, {
    category: "tauri",
    detail: command,
  });
}

/** Create a zero-arg Tauri command wrapper with perf instrumentation. */
export function tauriCommand<R>(name: string): () => Promise<R> {
  return () => invokeTauriCommandWithPerf<R>(name);
}

/**
 * Create a Tauri command wrapper that maps positional arguments to a
 * Tauri args record, with perf instrumentation.
 *
 * Curried so that the return type `R` is explicit while the arg tuple
 * type `A` is inferred from the mapper function.
 */
export function tauriArgs<R>(name: string) {
  return function <A extends unknown[]>(
    mapArgs: (...args: A) => Record<string, unknown>,
  ): (...args: A) => Promise<R> {
    return (...args: A) => invokeTauriCommandWithPerf<R>(name, mapArgs(...args));
  };
}

/** Create a zero-arg Tauri command wrapper without perf instrumentation. */
export function tauriCommandRaw<R>(name: string): () => Promise<R> {
  return () => invokeTauriCommandRaw<R>(name);
}
