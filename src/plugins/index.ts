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
  blockRenderPlugin,
} from "./plugin-render";
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
  embedFamilyPlugins,
} from "./default-plugins";
export {
  type ResolvedInclude,
  type FlattenRegion,
  type IncludeExpansionResult,
  IncludeCycleError,
  IncludeNotFoundError,
  IncludeExpansionCache,
  extractIncludePaths,
  resolveIncludePath,
  resolveIncludes,
  resolveIncludesFromContent,
  flattenIncludes,
  flattenIncludesWithSourceMap,
  collectIncludedPaths,
} from "./include-resolver";
