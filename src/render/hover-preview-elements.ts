import { CSS } from "../constants";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import {
  createPreviewSurfaceContent,
  createPreviewSurfaceHeader,
} from "../preview-surface";

export function createHoverPreviewHeader(
  text: string,
  macros: Record<string, string> = {},
  extraClass?: string,
): HTMLElement {
  const header = createPreviewSurfaceHeader(CSS.hoverPreviewHeader, extraClass);
  renderDocumentFragmentToDom(header, {
    kind: "title",
    text,
    macros,
  });
  return header;
}

export function createHoverPreviewContent(
  extraClass?: string | null,
): HTMLElement {
  return createPreviewSurfaceContent(CSS.hoverPreview, extraClass);
}
