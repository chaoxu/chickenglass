/**
 * Default block plugins for mathematical writing.
 *
 * All plugins are generated directly from BLOCK_MANIFEST — the manifest
 * is the single source of truth for block metadata. No per-plugin file
 * is needed for standard blocks.
 */

import type { BlockPlugin } from "./plugin-types";
import { BLOCK_MANIFEST_ENTRIES } from "../constants/block-manifest";
import { pluginFromManifest } from "./plugin-factory";

/** All default block plugins, generated from BLOCK_MANIFEST. */
export const defaultPlugins: readonly BlockPlugin[] = BLOCK_MANIFEST_ENTRIES.map(pluginFromManifest);

const theoremFamilyNames = new Set(
  BLOCK_MANIFEST_ENTRIES
    .filter((entry) => entry.bodyStyle === "italic")
    .map((entry) => entry.name),
);

/** Theorem-family plugins (italic body style in manifest). */
export const theoremFamilyPlugins: readonly BlockPlugin[] = defaultPlugins.filter(
  (plugin) => theoremFamilyNames.has(plugin.name),
);

/** Embed-family plugins (embed special behavior in manifest). */
export const embedFamilyPlugins: readonly BlockPlugin[] = defaultPlugins.filter(
  (plugin) => plugin.specialBehavior === "embed",
);
