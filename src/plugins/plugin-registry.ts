/**
 * Registry for block plugins.
 *
 * Plugins register themselves by class name. The renderer and counter
 * systems look up plugins through this registry. Supports runtime
 * registration and unregistration for custom block types defined
 * in frontmatter or project-level coflat.yaml.
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
import { capitalize } from "../lib/utils";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";

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
  /**
   * Per-state cache for auto-generated fallback plugins.
   *
   * Scoped to the state object rather than the module so it is discarded
   * whenever the registry is rebuilt (e.g. on frontmatter change), preventing
   * stale fallbacks from persisting across editor sessions.
   */
  readonly fallbackCache: Map<string, BlockPlugin>;
}

/** Create an empty registry state. */
export function createRegistryState(): PluginRegistryState {
  return { plugins: new Map(), disabled: new Set(), fallbackCache: new Map() };
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
  // Fresh cache: registered plugins supersede any existing fallback for this name.
  return { plugins: next, disabled: nextDisabled, fallbackCache: new Map() };
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
  // Fresh cache: registered plugins supersede any existing fallbacks.
  return { plugins: next, disabled: nextDisabled, fallbackCache: new Map() };
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
  // Fresh cache: unregistering a plugin invalidates any fallback entry for it.
  return { plugins: next, disabled: nextDisabled, fallbackCache: new Map() };
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
 * The fallback cache is stored on the PluginRegistryState object itself so
 * it is automatically scoped to the current registry snapshot. When the
 * registry is rebuilt (e.g. on frontmatter change), the old state is
 * discarded along with its cache, preventing stale fallbacks from leaking
 * across sessions.
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

  let fallback = state.fallbackCache.get(name);
  if (!fallback) {
    const title = capitalize(name);
    fallback = {
      name,
      numbered: true,
      title,
      render: createBlockRender(title),
    };
    state.fallbackCache.set(name, fallback);
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
  const title = config.title ?? existing?.title ?? capitalize(name);
  const numbered = config.numbered ?? existing?.numbered ?? true;

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

  return {
    name,
    counter,
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
const builtinPluginsFacet = Facet.define<
  readonly BlockPlugin[],
  readonly BlockPlugin[]
>({
  combine(values) {
    // Flatten all provided plugin arrays into one. Typically there is
    // exactly one provider (from createPluginRegistryField).
    return values.flat();
  },
});

function sameBuiltinPlugins(
  previous: readonly BlockPlugin[],
  next: readonly BlockPlugin[],
): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

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
    if (!tr.docChanged && !tr.reconfigured) return value;

    const previousBuiltins = tr.startState.facet(builtinPluginsFacet);
    const nextBuiltins = tr.state.facet(builtinPluginsFacet);
    const previousBlocksRevision = tr.startState.field(frontmatterField, false)?.blocksRevision ?? -1;
    const nextBlocksRevision = tr.state.field(frontmatterField, false)?.blocksRevision ?? -1;

    if (
      sameBuiltinPlugins(previousBuiltins, nextBuiltins)
      && previousBlocksRevision === nextBlocksRevision
    ) {
      return value;
    }

    // Use the `false` guard so this field can be used in editors that do
    // not include frontmatterField (e.g. inline editors, tests).
    const fm = tr.state.field(frontmatterField, false);
    return buildRegistry(nextBuiltins, fm?.config.blocks);
  },

  compare(a, b) {
    if (a.plugins.size !== b.plugins.size || a.disabled.size !== b.disabled.size) return false;
    for (const [key, pa] of a.plugins) {
      const pb = b.plugins.get(key);
      if (!pb || pa.numbered !== pb.numbered || pa.title !== pb.title || pa.counter !== pb.counter) return false;
    }
    for (const key of a.disabled) {
      if (!b.disabled.has(key)) return false;
    }
    return true;
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
