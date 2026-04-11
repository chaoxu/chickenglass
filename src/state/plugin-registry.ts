import { type Extension, Facet, StateField } from "@codemirror/state";
import type { BlockPlugin } from "../plugins/plugin-types";
import { type PluginRegistryState, buildRegistry } from "../plugins/plugin-registry";
import { frontmatterField } from "./frontmatter-state";

/**
 * Facet holding the built-in (default) plugins.
 *
 * The registry state field rebuilds from these defaults whenever frontmatter
 * changes, instead of accumulating on top of prior state.
 */
const builtinPluginsFacet = Facet.define<
  readonly BlockPlugin[],
  readonly BlockPlugin[]
>({
  combine(values) {
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
    const previousBlocksRevision =
      tr.startState.field(frontmatterField, false)?.blocksRevision ?? -1;
    const nextBlocksRevision =
      tr.state.field(frontmatterField, false)?.blocksRevision ?? -1;

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

  compare: Object.is,
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
