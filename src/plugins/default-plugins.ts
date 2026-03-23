/**
 * Default block plugins for mathematical writing.
 *
 * Derives the plugin list from BLOCK_MANIFEST so the manifest is
 * the single source of truth for block ordering and completeness.
 */

import type { BlockPlugin } from "./plugin-types";
import { BLOCK_MANIFEST } from "../constants/block-manifest";
import { theoremPlugin, lemmaPlugin, corollaryPlugin, propositionPlugin, conjecturePlugin } from "./theorem-plugin";
import { definitionPlugin } from "./definition-plugin";
import { proofPlugin } from "./proof-plugin";
import { remarkPlugin, examplePlugin } from "./remark-plugin";
import { algorithmPlugin } from "./algorithm-plugin";
import { problemPlugin } from "./problem-plugin";
import { blockquotePlugin } from "./blockquote-plugin";
import { embedPlugin, iframePlugin, youtubePlugin, gistPlugin } from "./embed-plugin";

const PLUGIN_BY_NAME: ReadonlyMap<string, BlockPlugin> = new Map<string, BlockPlugin>([
  [theoremPlugin.name, theoremPlugin],
  [lemmaPlugin.name, lemmaPlugin],
  [corollaryPlugin.name, corollaryPlugin],
  [propositionPlugin.name, propositionPlugin],
  [conjecturePlugin.name, conjecturePlugin],
  [definitionPlugin.name, definitionPlugin],
  [problemPlugin.name, problemPlugin],
  [proofPlugin.name, proofPlugin],
  [remarkPlugin.name, remarkPlugin],
  [examplePlugin.name, examplePlugin],
  [algorithmPlugin.name, algorithmPlugin],
  [blockquotePlugin.name, blockquotePlugin],
  [embedPlugin.name, embedPlugin],
  [iframePlugin.name, iframePlugin],
  [youtubePlugin.name, youtubePlugin],
  [gistPlugin.name, gistPlugin],
]);

/** All default block plugins, ordered by BLOCK_MANIFEST. */
export const defaultPlugins: readonly BlockPlugin[] = BLOCK_MANIFEST.map((entry) => {
  const plugin = PLUGIN_BY_NAME.get(entry.name);
  if (!plugin) {
    throw new Error(`Missing plugin for manifest entry "${entry.name}"`);
  }
  return plugin;
});
