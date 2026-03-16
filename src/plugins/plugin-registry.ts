/**
 * Registry for block plugins.
 *
 * Plugins register themselves by class name. The renderer and counter
 * systems look up plugins through this registry. Supports runtime
 * registration and unregistration for custom block types defined
 * in frontmatter.
 *
 * Also provides the CM6 StateField that holds the registry state,
 * so that both the counter and renderer can depend on it without
 * circular imports.
 */

import { type Extension, StateField } from "@codemirror/state";
import type { BlockAttrs, BlockPlugin } from "./plugin-types";
import type { BlockConfig } from "../parser/frontmatter";
import { frontmatterField } from "../editor/frontmatter-state";

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

/** Get all registered plugin names. */
export function getRegisteredNames(
  state: PluginRegistryState,
): readonly string[] {
  return [...state.plugins.keys()];
}

/**
 * Default render function for plugins created from frontmatter config.
 * Produces a simple header like "Theorem 1" or "Proof".
 */
function defaultRender(title: string) {
  return function render(attrs: BlockAttrs): {
    className: string;
    header: string;
  } {
    const numberSuffix = attrs.number !== undefined ? ` ${attrs.number}` : "";
    const titleSuffix = attrs.title ? ` (${attrs.title})` : "";
    return {
      className: `cg-block cg-block-${attrs.type}`,
      header: `${title}${numberSuffix}${titleSuffix}`,
    };
  };
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
  const title = config.title ?? name.charAt(0).toUpperCase() + name.slice(1);
  const numbered = config.numbered ?? true;
  return {
    name,
    counter: config.counter,
    numbered,
    title,
    render: defaultRender(title),
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
// CM6 StateField
// ---------------------------------------------------------------------------

/**
 * CM6 StateField holding the plugin registry.
 *
 * On creation, starts empty. On doc change, re-applies frontmatter
 * block definitions. Use `createPluginRegistryField` to pre-load
 * an initial set of plugins.
 */
export const pluginRegistryField = StateField.define<PluginRegistryState>({
  create() {
    return createRegistryState();
  },

  update(value, tr) {
    if (tr.docChanged) {
      const fm = tr.state.field(frontmatterField);
      let result = value;
      if (fm.config.blocks) {
        result = applyFrontmatterBlocks(value, fm.config.blocks);
      }
      return result;
    }
    return value;
  },
});

/**
 * Create a pluginRegistryField pre-loaded with an initial set of plugins.
 * This is the recommended way to initialize the registry.
 */
export function createPluginRegistryField(
  initialPlugins: readonly BlockPlugin[],
): Extension {
  return pluginRegistryField.init((state) => {
    let registry = registerPlugins(createRegistryState(), initialPlugins);
    const fm = state.field(frontmatterField, false);
    if (fm?.config.blocks) {
      registry = applyFrontmatterBlocks(registry, fm.config.blocks);
    }
    return registry;
  });
}
