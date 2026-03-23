/**
 * Factory for creating standard block plugins.
 *
 * Reduces boilerplate for theorem-family and similar plugins that
 * follow the common pattern of name + counter + numbered + title + render.
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";
import { capitalize } from "../lib/utils";

/** Options for creating a standard block plugin. */
export interface StandardPluginOptions {
  /** Class name that triggers this plugin (e.g. "theorem"). */
  readonly name: string;
  /**
   * Display title shown in the rendered header.
   * Defaults to the name with the first letter capitalized.
   */
  readonly title?: string;
  /** Whether this block type is auto-numbered. Defaults to true. */
  readonly numbered?: boolean;
  /**
   * Counter group name. Plugins sharing the same counter group
   * increment a single shared counter. If undefined, uses `name`
   * as the counter group when `numbered` is true.
   */
  readonly counter?: string;
  /** Default settings (e.g. QED symbol, CSS overrides). */
  readonly defaults?: Readonly<Record<string, unknown>>;
}

/**
 * Create a standard block plugin from minimal options.
 *
 * Captures the shared boilerplate: auto-capitalizes the title,
 * defaults numbered to true, and wires up createBlockRender.
 *
 * @example
 * ```ts
 * const theoremPlugin = createStandardPlugin({
 *   name: "theorem",
 *   counter: THEOREM_COUNTER,
 * });
 * ```
 */
export function createStandardPlugin(options: StandardPluginOptions): BlockPlugin {
  const title = options.title ?? capitalize(options.name);
  const numbered = options.numbered ?? true;
  return {
    name: options.name,
    ...(options.counter !== undefined ? { counter: options.counter } : {}),
    numbered,
    title,
    render: createBlockRender(title),
    ...(options.defaults !== undefined ? { defaults: options.defaults } : {}),
  };
}
