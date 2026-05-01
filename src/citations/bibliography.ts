import { type CslJsonItem, extractFirstFamilyName, extractYear, formatCslAuthors } from "./csl-json";
import {
  type CitationBacklink,
} from "./csl-processor";
import { findNextInlineMathSource } from "../lib/inline-math-source";
import { sanitizeCslHtml } from "../lib/sanitize-csl-html";
import { type BibStore } from "../state/bib-data";

/**
 * Format a bibliography entry as a text string.
 * Uses a simplified format: Author. Title. Venue, Year.
 */
export function formatBibEntry(entry: CslJsonItem): string {
  const parts: string[] = [];

  const authorStr = formatCslAuthors(entry.author);
  if (authorStr) {
    parts.push(authorStr);
  }

  if (entry.title) {
    parts.push(entry.title);
  }

  const venue = entry["container-title"];
  if (venue) {
    let venuePart = venue;
    if (entry.volume) {
      venuePart += `, ${entry.volume}`;
      if (entry.issue) {
        venuePart += `(${entry.issue})`;
      }
    }
    if (entry.page) {
      venuePart += `, ${entry.page}`;
    }
    parts.push(venuePart);
  }

  const year = extractYear(entry);
  if (year) {
    parts.push(year);
  }

  return parts.join(". ") + ".";
}

/**
 * Sort bibliography entries alphabetically by first author's last name,
 * then by year.
 */
export function sortBibEntries(entries: CslJsonItem[]): CslJsonItem[] {
  return [...entries].sort((a, b) => {
    const nameA = extractFirstFamilyName(a.author, a.id).toLowerCase();
    const nameB = extractFirstFamilyName(b.author, b.id).toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    const yearA = extractYear(a) ?? "";
    const yearB = extractYear(b) ?? "";
    return yearA < yearB ? -1 : yearA > yearB ? 1 : 0;
  });
}

export function buildCitationBacklinkMap(
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): Map<string, readonly CitationBacklink[]> {
  return new Map(backlinks);
}

export function buildBibliographyEntries(
  store: BibStore,
  citedIds: readonly string[],
  cslHtml: readonly string[],
): Array<{
  readonly id: string;
  readonly plainText: string;
  readonly renderedHtml?: string;
}> {
  const entries = citedIds
    .map((id) => store.get(id))
    .filter((entry): entry is CslJsonItem => entry !== undefined);

  if (cslHtml.length > 0) {
    return entries.map((entry, index) => {
      const plainText = formatBibEntry(entry);
      return {
        id: entry.id,
        plainText,
        renderedHtml: findNextInlineMathSource(plainText, 0, { requireTightDollar: true }) !== null
          ? undefined
          : sanitizeCslHtml(cslHtml[index] ?? ""),
      };
    });
  }

  return sortBibEntries(entries).map((entry) => ({
    id: entry.id,
    plainText: formatBibEntry(entry),
  }));
}
