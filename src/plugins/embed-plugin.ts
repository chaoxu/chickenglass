/**
 * Embed block plugins for custom content blocks.
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

import type { BlockAttrs, BlockDecorationSpec, BlockPlugin } from "./plugin-types";

/** Validate that a URL is safe for embedding (https only). */
export function isValidEmbedUrl(url: string): boolean {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Extract YouTube video ID from various YouTube URL formats.
 *
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 *
 * Returns undefined if no video ID can be extracted.
 */
export function extractYoutubeId(url: string): string | undefined {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);

    // youtube.com/watch?v=ID
    if (
      (parsed.hostname === "www.youtube.com" ||
        parsed.hostname === "youtube.com") &&
      parsed.pathname === "/watch"
    ) {
      return parsed.searchParams.get("v") ?? undefined;
    }

    // youtu.be/ID
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.slice(1);
      return id.length > 0 ? id : undefined;
    }

    // youtube.com/embed/ID
    if (
      (parsed.hostname === "www.youtube.com" ||
        parsed.hostname === "youtube.com") &&
      parsed.pathname.startsWith("/embed/")
    ) {
      const id = parsed.pathname.slice("/embed/".length);
      return id.length > 0 ? id : undefined;
    }
  } catch {
    // Invalid URL
  }
  return undefined;
}

/**
 * Build a YouTube embed URL from a video ID.
 */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

/**
 * Build a GitHub Gist embed URL.
 *
 * Gist URLs like https://gist.github.com/user/abc123 can be loaded
 * in an iframe by appending .pibb to get the rendered view.
 */
export function gistEmbedUrl(url: string): string {
  const trimmed = url.trim();
  // Append .pibb for the rendered iframe-friendly view
  if (trimmed.endsWith(".pibb")) return trimmed;
  return trimmed.endsWith("/") ? `${trimmed.slice(0, -1)}.pibb` : `${trimmed}.pibb`;
}

/** Create a render function for embed-type plugins. */
function createEmbedRender(displayTitle: string) {
  return function render(attrs: BlockAttrs): BlockDecorationSpec {
    const parts = [displayTitle];
    if (attrs.title) {
      parts.push(` (${attrs.title})`);
    }
    return {
      className: `cg-block cg-block-${attrs.type}`,
      header: parts.join(""),
    };
  };
}

/** Generic embed plugin — renders any https URL as an iframe. */
export const embedPlugin: BlockPlugin = {
  name: "embed",
  numbered: false,
  title: "Embed",
  render: createEmbedRender("Embed"),
};

/** Plain iframe plugin — renders URL as a plain iframe. */
export const iframePlugin: BlockPlugin = {
  name: "iframe",
  numbered: false,
  title: "Iframe",
  render: createEmbedRender("Iframe"),
};

/** YouTube embed plugin — extracts video ID and renders responsive 16:9. */
export const youtubePlugin: BlockPlugin = {
  name: "youtube",
  numbered: false,
  title: "YouTube",
  render: createEmbedRender("YouTube"),
};

/** GitHub Gist embed plugin. */
export const gistPlugin: BlockPlugin = {
  name: "gist",
  numbered: false,
  title: "Gist",
  render: createEmbedRender("Gist"),
};

/** All embed-family plugins as an array. */
export const embedFamilyPlugins: readonly BlockPlugin[] = [
  embedPlugin,
  iframePlugin,
  youtubePlugin,
  gistPlugin,
];
