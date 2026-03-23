/**
 * Factory for creating standard block plugins.
 *
 * Reduces boilerplate for theorem-family and similar plugins that
 * follow the common pattern of name + counter + numbered + title + render.
 */

import type { BlockPlugin } from "./plugin-types";
import type { SpecialBehavior } from "../constants/block-manifest";
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
  /**
   * Special rendering behavior for this block type.
   * Mirrors BlockManifestEntry.specialBehavior — set this to keep
   * the plugin in sync with the manifest.
   */
  readonly specialBehavior?: SpecialBehavior;
  /**
   * Whether to show a rendered header label for this block type.
   * Mirrors BlockPlugin.displayHeader — defaults to true when omitted.
   */
  readonly displayHeader?: boolean;
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
    ...(options.specialBehavior !== undefined ? { specialBehavior: options.specialBehavior } : {}),
    ...(options.displayHeader !== undefined ? { displayHeader: options.displayHeader } : {}),
  };
}
