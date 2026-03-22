/** Public inline rendering surfaces shared across title-like and UI chrome views. */
export type InlineRenderSurface = "document-inline" | "ui-chrome-inline";

/** Return true when a surface should degrade rich inline content into inert chrome-safe text. */
export function isUiChromeInline(surface: InlineRenderSurface): boolean {
  return surface === "ui-chrome-inline";
}
