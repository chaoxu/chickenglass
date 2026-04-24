/**
 * Typed factory for Tauri command wrappers.
 *
 * Each Rust command is passed as a contract entry, so wrapper names and
 * payload keys are checked against the shared command contract.
 *
 * Usage:
 *   tauriCommand(tauriCommands.group.command)                    // no-arg
 *   tauriArgs(tauriCommands.group.command)((a, b) => ({ a, b })) // with args
 */

import { measureAsync } from "../../lib/perf";
import type {
  TauriArgsCommandName,
  TauriCommandArgs,
  TauriCommandDefinition,
  TauriCommandName,
  TauriCommandResult,
  TauriNoArgCommandName,
} from "./command-contract";
import { invokeTauriCommandRaw } from "./core";

function invokeTauriCommandWithPerf<T>(
  command: TauriCommandName,
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
export function tauriCommand<Name extends TauriNoArgCommandName>(
  command: TauriCommandDefinition<Name>,
): () => Promise<TauriCommandResult<Name>> {
  return () => invokeTauriCommandWithPerf<TauriCommandResult<Name>>(command.name);
}

/**
 * Create a Tauri command wrapper that maps positional arguments to a
 * Tauri args record, with perf instrumentation.
 *
 * Curried so that the return type `R` is explicit while the arg tuple
 * type `A` is inferred from the mapper function.
 */
export function tauriArgs<Name extends TauriArgsCommandName>(
  command: TauriCommandDefinition<Name>,
) {
  return function <A extends unknown[]>(
    mapArgs: (...args: A) => TauriCommandArgs<Name>,
  ): (...args: A) => Promise<TauriCommandResult<Name>> {
    return (...args: A) =>
      invokeTauriCommandWithPerf<TauriCommandResult<Name>>(
        command.name,
        mapArgs(...args),
      );
  };
}

/** Create a zero-arg Tauri command wrapper without perf instrumentation. */
export function tauriCommandRaw<Name extends TauriNoArgCommandName>(
  command: TauriCommandDefinition<Name>,
): () => Promise<TauriCommandResult<Name>> {
  return () => invokeTauriCommandRaw<TauriCommandResult<Name>>(command.name);
}
