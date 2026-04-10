/**
 * Embed-family plugin definitions and URL helpers.
 *
 * These plugins own the iframe-style rich rendering behavior so the
 * core plugin renderer does not need embed-specific branches.
 *
 * Supports embedding external content via iframes:
 * - `.embed` — generic embed (renders URL as iframe)
 * - `.iframe` — plain iframe
 * - `.youtube` — YouTube embed (extracts video ID, renders responsive 16:9)
 * - `.gist` — GitHub gist embed
 *
 * Syntax:
 * ```markdown
 * ::: {.youtube}
 * https://www.youtube.com/watch?v=dQw4w9WgXcQ
 * :::
 * ```
 *
 * Security: Only https:// URLs are allowed. Iframes use sandbox attributes.
 */

import type { BlockPlugin, BlockRenderDecorations } from "./plugin-types";
import { type StandardPluginOptions, createStandardPlugin } from "./plugin-factory";
import { addEmbedWidget } from "../render/plugin-adapters/embed";

export {
  extractYoutubeId,
  gistEmbedUrl,
  isValidEmbedUrl,
  youtubeEmbedUrl,
} from "./embed-url";

const embedRenderDecorations: BlockRenderDecorations = {
  addBodyDecorations({ adapter, state, div, items, activeShell, openerSourceActive }) {
    if (openerSourceActive) return;
    addEmbedWidget(adapter, state, div, items, activeShell);
  },
};

const EMBED_PLUGIN_OPTIONS = [
  { name: "embed", numbered: false, specialBehavior: "embed", renderDecorations: embedRenderDecorations },
  { name: "iframe", numbered: false, specialBehavior: "embed", renderDecorations: embedRenderDecorations },
  { name: "youtube", numbered: false, specialBehavior: "embed", title: "YouTube", renderDecorations: embedRenderDecorations },
  { name: "gist", numbered: false, specialBehavior: "embed", renderDecorations: embedRenderDecorations },
] as const satisfies readonly StandardPluginOptions[];

/** Embed-family plugins with plugin-owned iframe rendering hooks. */
export const embedPlugins: readonly BlockPlugin[] = EMBED_PLUGIN_OPTIONS.map(createStandardPlugin);
