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

import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { FencedDivInfo } from "../fenced-block/model";
import type { BlockPlugin, BlockRenderDecorations } from "./plugin-types";
import { type StandardPluginOptions, createStandardPlugin } from "./plugin-factory";
import {
  type PluginRenderAdapter,
  pushPluginWidgetDecoration,
} from "./plugin-render-adapter";
import {
  extractYoutubeId,
  gistEmbedUrl,
  isValidEmbedUrl,
  youtubeEmbedUrl,
} from "./embed-url";

export {
  extractYoutubeId,
  gistEmbedUrl,
  isValidEmbedUrl,
  youtubeEmbedUrl,
} from "./embed-url";

function computeEmbedSrc(
  embedType: string,
  rawUrl: string,
): string | undefined {
  const url = rawUrl.trim();
  if (!isValidEmbedUrl(url)) return undefined;

  switch (embedType) {
    case "youtube": {
      const videoId = extractYoutubeId(url);
      return videoId ? youtubeEmbedUrl(videoId) : undefined;
    }
    case "gist":
      return gistEmbedUrl(url);
    case "embed":
    case "iframe":
    default:
      return url;
  }
}

function addEmbedWidgetDecoration(
  state: EditorState,
  div: FencedDivInfo,
  items: Range<Decoration>[],
  adapter: PluginRenderAdapter,
  active: boolean,
): void {
  if (div.singleLine || div.closeFenceFrom < 0) return;

  const openLine = state.doc.lineAt(div.openFenceFrom);
  const bodyFrom = openLine.to + 1;
  const bodyTo = div.closeFenceFrom - 1;
  if (bodyFrom > bodyTo) return;

  const rawUrl = state.sliceDoc(bodyFrom, bodyTo).trim();
  const src = computeEmbedSrc(div.className, rawUrl);
  if (!src) return;

  pushPluginWidgetDecoration(
    items,
    adapter.createEmbedWidget(src, div.className, active),
    bodyFrom,
    bodyTo,
  );
}

const embedRenderDecorations: BlockRenderDecorations = {
  addBodyDecorations({ adapter, state, div, items, activeShell, openerSourceActive }) {
    if (openerSourceActive) return;
    addEmbedWidgetDecoration(
      state,
      div,
      items,
      adapter,
      activeShell,
    );
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
