import { type EditorState, type Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { FencedDivInfo } from "../fenced-block/model";
import {
  extractYoutubeId,
  gistEmbedUrl,
  isValidEmbedUrl,
  youtubeEmbedUrl,
} from "./embed-plugin";
import {
  type PluginRenderAdapter,
  pushPluginWidgetDecoration,
} from "./plugin-render-adapter";

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

/** Replace embed block body content with an iframe widget. */
export function addEmbedWidget(
  adapter: PluginRenderAdapter,
  state: EditorState,
  div: FencedDivInfo,
  openLine: { readonly to: number },
  items: Range<Decoration>[],
  active: boolean,
): void {
  if (div.singleLine || div.closeFenceFrom < 0) return;

  const bodyFrom = openLine.to + 1;
  const bodyTo = div.closeFenceFrom - 1;
  if (bodyFrom > bodyTo) return;

  const bodyText = state.sliceDoc(bodyFrom, bodyTo);
  const rawUrl = bodyText.trim();
  const src = computeEmbedSrc(div.className, rawUrl);
  if (src) {
    pushPluginWidgetDecoration(
      items,
      adapter.createEmbedWidget(src, div.className, active),
      bodyFrom,
      bodyTo,
    );
  }
}
