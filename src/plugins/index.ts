export type {
  BlockPlugin,
  BlockAttrs,
  BlockDecorationSpec,
} from "./plugin-types";
export {
  type PluginRegistryState,
  createRegistryState,
  registerPlugin,
  registerPlugins,
  unregisterPlugin,
  getPlugin,
  getPluginOrFallback,
  getRegisteredNames,
  pluginFromConfig,
  applyFrontmatterBlocks,
} from "./plugin-registry";
export {
  type NumberedBlock,
  type BlockCounterState,
  computeBlockNumbers,
  emptyCounterState,
} from "./block-counter";
export {
  fenceOperationAnnotation,
} from "./fence-protection";
export {
  formatBlockHeader,
  createBlockRender,
} from "./block-render";
export {
  createStandardPlugin,
  pluginFromManifest,
  type StandardPluginOptions,
} from "./plugin-factory";
export { QED_SYMBOL } from "./proof-plugin";
export {
  defaultPlugins,
  theoremFamilyPlugins,
} from "./default-plugins";
