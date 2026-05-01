import type { CslJsonItem } from "./bibtex-parser";
import { CSS } from "../constants/css-classes";
import { formatBibEntry } from "./bibliography";

export interface CitationPreviewContent {
  /** Bibliography entry text (Author. Title. Venue. Year.). */
  readonly entry: string;
  /** Optional rendered citation form (e.g. "(Karger 2000)") shown as a header. */
  readonly formatted?: string;
}

export function formatCitationPreview(entry: CslJsonItem): string {
  return formatBibEntry(entry);
}

export function buildCitationPreviewContent(
  preview: string | CitationPreviewContent,
): HTMLDivElement {
  const root = document.createElement("div");
  root.className = CSS.citationPreview;

  const content: CitationPreviewContent =
    typeof preview === "string" ? { entry: preview } : preview;

  if (content.formatted) {
    const header = document.createElement("div");
    header.className = `${CSS.citationPreview}-formatted`;
    header.textContent = content.formatted;
    root.appendChild(header);
  }

  const body = document.createElement("div");
  body.className = `${CSS.citationPreview}-entry`;
  body.textContent = content.entry;
  root.appendChild(body);

  return root;
}

export function buildCitationPreviewContentFromEntry(entry: CslJsonItem): HTMLDivElement {
  return buildCitationPreviewContent(formatCitationPreview(entry));
}
