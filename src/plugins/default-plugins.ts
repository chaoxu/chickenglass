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

/** Theorem-family plugins (italic body style in manifest). */
export const theoremFamilyPlugins: readonly BlockPlugin[] = defaultPlugins.filter(
  (_, i) => BLOCK_MANIFEST_ENTRIES[i].bodyStyle === "italic",
);

/** Embed-family plugins (embed special behavior in manifest). */
export const embedFamilyPlugins: readonly BlockPlugin[] = defaultPlugins.filter(
  (_, i) => BLOCK_MANIFEST_ENTRIES[i].specialBehavior === "embed",
);
