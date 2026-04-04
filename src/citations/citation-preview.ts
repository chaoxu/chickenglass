import type { CslJsonItem } from "./bibtex-parser";
import { CSS } from "../constants/css-classes";
import { formatBibEntry } from "./bibliography";

export function formatCitationPreview(entry: CslJsonItem): string {
  return formatBibEntry(entry);
}

export function buildCitationPreviewContent(preview: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = CSS.citationPreview;
  element.textContent = preview;
  return element;
}

export function buildCitationPreviewContentFromEntry(entry: CslJsonItem): HTMLDivElement {
  return buildCitationPreviewContent(formatCitationPreview(entry));
}
