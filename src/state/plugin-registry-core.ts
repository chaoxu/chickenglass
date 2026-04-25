/**
 * Registry for block plugins.
 *
 * Plugins register themselves by class name. The renderer and counter
 * systems look up plugins through this registry. Supports runtime
 * registration and unregistration for custom block types defined
 * in frontmatter or project-level coflat.yaml.
 *
 */

import type { BlockPlugin } from "./block-plugin";
import type { BlockConfig } from "../parser/frontmatter";
import { createBlockRender } from "./block-render";
import { capitalize, pickDefined } from "../lib/utils";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import {
  STANDARD_PLUGIN_METADATA_KEYS,
  createStandardPlugin,
} from "./plugin-factory";

/**
 * Immutable snapshot of the registry state.
 * Used as the value in the CM6 StateField.
 */
export interface PluginRegistryState {
  readonly plugins: ReadonlyMap<string, BlockPlugin>;
  /**
   * Block class names that have been explicitly disabled (blocks: { name: false }).
   *
   * Disabled blocks are excluded from fallback plugin generation so they render
   * as raw ::: fences instead of numbered blocks. This is distinct from simply
   * not being registered: a block may be unregistered but still get a fallback
   * unless it is explicitly in this set.
   */
  readonly disabled: ReadonlySet<string>;
}

/** Create an empty registry state. */
export function createRegistryState(): PluginRegistryState {
  return { plugins: new Map(), disabled: new Set() };
}

/** Register a plugin, returning a new state. */
export function registerPlugin(
  state: PluginRegistryState,
  plugin: BlockPlugin,
): PluginRegistryState {
  const next = new Map(state.plugins);
  next.set(plugin.name, plugin);
  // Re-enabling a previously disabled block clears it from the disabled set.
  const nextDisabled = new Set(state.disabled);
  nextDisabled.delete(plugin.name);
  return { plugins: next, disabled: nextDisabled };
}

/** Register multiple plugins at once, returning a new state. */
export function registerPlugins(
  state: PluginRegistryState,
  plugins: readonly BlockPlugin[],
): PluginRegistryState {
  const next = new Map(state.plugins);
  const nextDisabled = new Set(state.disabled);
  for (const plugin of plugins) {
    next.set(plugin.name, plugin);
    nextDisabled.delete(plugin.name);
  }
  return { plugins: next, disabled: nextDisabled };
}

/**
 * Unregister a plugin by name and mark it as explicitly disabled.
 *
 * Disabled blocks are excluded from fallback generation so they render as raw
 * ::: fences instead of auto-numbered blocks. Use `disabled: true` in the
 * returned state to distinguish "explicitly off" from "never registered."
 */
export function unregisterPlugin(
  state: PluginRegistryState,
  name: string,
): PluginRegistryState {
  const next = new Map(state.plugins);
  next.delete(name);
  const nextDisabled = new Set(state.disabled);
  nextDisabled.add(name);
  return { plugins: next, disabled: nextDisabled };
}

/** Look up a plugin by fenced div class name. */
export function getPlugin(
  state: PluginRegistryState,
  name: string,
): BlockPlugin | undefined {
  return state.plugins.get(name);
}

/**
 * Look up a plugin by name, or create a default fallback plugin on-the-fly.
 *
 * Fallback plugins render with the class name capitalized as the title,
 * are numbered by default, and use the class name as the counter group.
 * This ensures that any `::: {.anything}` fenced div renders as a
 * formatted block even without explicit registration.
 *
 * Special class names (e.g., "include") are excluded from fallback
 * generation — those are handled separately by the renderer.
 *
 * Fallback plugin creation is pure with respect to PluginRegistryState: lookup
 * never mutates the state object stored in the CM6 StateField.
 */
export function getPluginOrFallback(
  state: PluginRegistryState,
  name: string,
): BlockPlugin | undefined {
  const registered = state.plugins.get(name);
  if (registered) return registered;

  // Explicitly disabled blocks (blocks: { name: false }) must not get a fallback.
  // This is the mechanism that causes disabled blocks to render as raw ::: fences.
  if (state.disabled.has(name)) return undefined;

  if (EXCLUDED_FROM_FALLBACK.has(name)) return undefined;

  const title = capitalize(name);
  return Object.freeze({
    name,
    numbered: true,
    title,
    render: createBlockRender(title),
  });
}

/** Get all registered plugin names. */
export function getRegisteredNames(
  state: PluginRegistryState,
): readonly string[] {
  return [...state.plugins.keys()];
}

/**
 * Create a BlockPlugin from a frontmatter BlockConfig entry.
 *
 * When `existing` is provided (i.e. the name matches a built-in plugin),
 * unspecified config fields inherit from the existing plugin. This prevents
 * a partial override (e.g. only `title`) from losing the built-in's counter
 * group. See issue #493.
 *
 * Counter semantics:
 * - `config.counter === undefined` → inherit from `existing` (or undefined)
 * - `config.counter === null` → explicitly remove counter group
 * - `config.counter === "group"` → use that counter group
 *
 * Frontmatter can define custom block types:
 * ```yaml
 * blocks:
 *   conjecture:
 *     counter: theorem
 *     numbered: true
 *     title: Conjecture
 * ```
 */
export function pluginFromConfig(
  name: string,
  config: BlockConfig,
  existing?: BlockPlugin,
): BlockPlugin {
  const title = config.title ?? existing?.title;
  const numbered = config.numbered ?? existing?.numbered;

  // Distinguish undefined (inherit) from null (remove group).
  // config.counter === undefined → inherit from existing plugin.
  // config.counter === null → explicitly no counter group.
  // config.counter === "string" → use that counter group.
  let counter: string | undefined;
  if (config.counter === undefined) {
    counter = existing?.counter;
  } else if (config.counter === null) {
    counter = undefined;
  } else {
    counter = config.counter;
  }

  const existingCm6 = (existing as (BlockPlugin & { readonly cm6?: unknown }) | undefined)?.cm6;
  const plugin = createStandardPlugin({
    name,
    ...(title !== undefined ? { title } : {}),
    ...(numbered !== undefined ? { numbered } : {}),
    ...(counter !== undefined ? { counter } : {}),
    ...(existing ? pickDefined(existing, STANDARD_PLUGIN_METADATA_KEYS) : {}),
  });

  if (existingCm6 !== undefined) {
    const pluginWithCm6Extension = { ...plugin, cm6: existingCm6 };
    return pluginWithCm6Extension;
  }

  return plugin;
}

/**
 * Merge frontmatter block definitions into the registry.
 *
 * Entries with `true` are skipped (they just enable an already-registered
 * plugin). Entries with `false` unregister the plugin. Entries with a
 * BlockConfig object create or replace a plugin.
 *
 * When a BlockConfig partially overrides an existing plugin (e.g. only
 * changes `title`), unspecified fields are inherited from the existing
 * plugin. See issue #493.
 */
export function applyFrontmatterBlocks(
  state: PluginRegistryState,
  blocks: Readonly<Record<string, boolean | BlockConfig>>,
): PluginRegistryState {
  let result = state;
  for (const [name, value] of Object.entries(blocks)) {
    if (value === true) {
      continue;
    } else if (value === false) {
      result = unregisterPlugin(result, name);
    } else {
      // Pass existing plugin so partial overrides inherit unspecified fields.
      const existing = result.plugins.get(name);
      result = registerPlugin(result, pluginFromConfig(name, value, existing));
    }
  }
  return result;
}

/**
 * Build a fresh registry from built-in plugins + frontmatter blocks.
 *
 * This is the single source of truth for registry construction from registry
 * inputs. CM6 wiring that decides when to rebuild lives in
 * `src/state/plugin-registry.ts`.
 */
export function buildRegistry(
  builtins: readonly BlockPlugin[],
  blocks: Readonly<Record<string, boolean | BlockConfig>> | undefined,
): PluginRegistryState {
  let registry = registerPlugins(createRegistryState(), builtins);
  if (blocks) {
    registry = applyFrontmatterBlocks(registry, blocks);
  }
  return registry;
}
