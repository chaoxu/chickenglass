import { resolveMarkdownReferencePathFromDocument } from "../lib/markdown-reference-paths";
import { isRelativeFilePath } from "../lib/pdf-target";

export interface PreviewImageOverrideContext {
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
}

export function applyPreviewImageOverrides(
  container: HTMLElement,
  context: PreviewImageOverrideContext,
): void {
  if (!context.imageUrlOverrides || context.imageUrlOverrides.size === 0) return;

  for (const img of container.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || !isRelativeFilePath(src)) continue;

    const resolvedPath = resolveMarkdownReferencePathFromDocument(
      context.documentPath ?? "",
      src,
    );
    const override = context.imageUrlOverrides.get(resolvedPath);
    if (override) {
      img.setAttribute("src", override);
    }
  }
}
