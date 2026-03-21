/**
 * Registry for block plugins.
 *
 * Plugins register themselves by class name. The renderer and counter
 * systems look up plugins through this registry. Supports runtime
 * registration and unregistration for custom block types defined
 * in frontmatter or project-level chickenglass.yaml.
 *
 * Also provides the CM6 StateField that holds the registry state,
 * so that both the counter and renderer can depend on it without
 * circular imports.
 */

import { type Extension, Facet, StateField } from "@codemirror/state";
import type { BlockPlugin } from "./plugin-types";
import type { BlockConfig } from "../parser/frontmatter";
import { frontmatterField } from "../editor/frontmatter-state";
import { createBlockRender } from "./block-render";
import { capitalize } from "../app/lib/utils";

/**
 * Immutable snapshot of the registry state.
 * Used as the value in the CM6 StateField.
 */
export interface PluginRegistryState {
  readonly plugins: ReadonlyMap<string, BlockPlugin>;
}

/** Create an empty registry state. */
export function createRegistryState(): PluginRegistryState {
  return { plugins: new Map() };
}

/** Register a plugin, returning a new state. */
export function registerPlugin(
  state: PluginRegistryState,
  plugin: BlockPlugin,
): PluginRegistryState {
  const next = new Map(state.plugins);
  next.set(plugin.name, plugin);
  return { plugins: next };
}

/** Register multiple plugins at once, returning a new state. */
export function registerPlugins(
  state: PluginRegistryState,
  plugins: readonly BlockPlugin[],
): PluginRegistryState {
  const next = new Map(state.plugins);
  for (const plugin of plugins) {
    next.set(plugin.name, plugin);
  }
  return { plugins: next };
}

/** Unregister a plugin by name, returning a new state. */
export function unregisterPlugin(
  state: PluginRegistryState,
  name: string,
): PluginRegistryState {
  if (!state.plugins.has(name)) return state;
  const next = new Map(state.plugins);
  next.delete(name);
  return { plugins: next };
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
 */
const EXCLUDED_FROM_FALLBACK = new Set(["include"]);

/** Cache for fallback plugins to avoid re-creating them on every tree walk. */
const fallbackCache = new Map<string, BlockPlugin>();

export function getPluginOrFallback(
  state: PluginRegistryState,
  name: string,
): BlockPlugin | undefined {
  const registered = state.plugins.get(name);
  if (registered) return registered;

  if (EXCLUDED_FROM_FALLBACK.has(name)) return undefined;

  let fallback = fallbackCache.get(name);
  if (!fallback) {
    const title = capitalize(name);
    fallback = {
      name,
      numbered: true,
      title,
      render: createBlockRender(title),
    };
    fallbackCache.set(name, fallback);
  }
  return fallback;
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
): BlockPlugin {
  const title = config.title ?? capitalize(name);
  const numbered = config.numbered ?? true;
  return {
    name,
    counter: config.counter,
    numbered,
    title,
    render: createBlockRender(title),
  };
}

/**
 * Merge frontmatter block definitions into the registry.
 *
 * Entries with `true` are skipped (they just enable an already-registered
 * plugin). Entries with `false` unregister the plugin. Entries with a
 * BlockConfig object create or replace a plugin.
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
      result = registerPlugin(result, pluginFromConfig(name, value));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CM6 Facet & StateField
// ---------------------------------------------------------------------------

/**
 * Facet holding the built-in (default) plugins.
 *
 * Used by the plugin registry StateField to rebuild from defaults
 * whenever frontmatter changes, instead of accumulating on top of
 * previous state.
 */
export const builtinPluginsFacet = Facet.define<
  readonly BlockPlugin[],
  readonly BlockPlugin[]
>({
  combine(values) {
    // Flatten all provided plugin arrays into one. Typically there is
    // exactly one provider (from createPluginRegistryField).
    return values.flat();
  },
});

/**
 * Build a fresh registry from built-in plugins + frontmatter blocks.
 *
 * This is the single source of truth for registry construction.
 * Both `create` and `update` use it so the registry is always
 * a deterministic function of (builtins + merged frontmatter).
 */
function buildRegistry(
  builtins: readonly BlockPlugin[],
  blocks: Readonly<Record<string, boolean | BlockConfig>> | undefined,
): PluginRegistryState {
  let registry = registerPlugins(createRegistryState(), builtins);
  if (blocks) {
    registry = applyFrontmatterBlocks(registry, blocks);
  }
  return registry;
}

/**
 * CM6 StateField holding the plugin registry.
 *
 * On creation, loads built-in plugins from the builtinPluginsFacet
 * and applies frontmatter block definitions. On doc change, rebuilds
 * from defaults so removed frontmatter entries are properly reflected.
 *
 * Use `createPluginRegistryField` to pre-load an initial set of plugins.
 */
export const pluginRegistryField = StateField.define<PluginRegistryState>({
  create(state) {
    const builtins = state.facet(builtinPluginsFacet);
    const fm = state.field(frontmatterField, false);
    return buildRegistry(builtins, fm?.config.blocks);
  },

  update(value, tr) {
    if (tr.docChanged) {
      const builtins = tr.state.facet(builtinPluginsFacet);
      const fm = tr.state.field(frontmatterField);
      return buildRegistry(builtins, fm.config.blocks);
    }
    return value;
  },
});

/**
 * Create a pluginRegistryField pre-loaded with an initial set of plugins.
 * This is the recommended way to initialize the registry.
 *
 * Provides the plugins via the builtinPluginsFacet so the StateField's
 * update logic can rebuild from defaults on every frontmatter change.
 */
export function createPluginRegistryField(
  initialPlugins: readonly BlockPlugin[],
): Extension {
  return [
    builtinPluginsFacet.of(initialPlugins),
    pluginRegistryField,
  ];
}
