/** CSL-JSON item shape produced by citation-js. */
export interface CslJsonItem {
  id: string;
  type: string;
  "citation-key"?: string;
  author?: Array<{ family?: string; given?: string; literal?: string }>;
  title?: string;
  "container-title"?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  edition?: string;
  issued?: { "date-parts"?: number[][] };
  [key: string]: unknown;
}

export type BibStore = ReadonlyMap<string, CslJsonItem>;

/**
 * Extract the first author's family name from a CSL-JSON author array.
 * Returns the id string as fallback when no authors are present.
 */
export function extractFirstFamilyName(
  authors: CslJsonItem["author"],
  fallback: string,
): string {
  if (!authors || authors.length === 0) return fallback;
  const first = authors[0];
  return first.literal ?? first.family ?? fallback;
}

/**
 * Extract the year string from a CSL-JSON issued field.
 * Returns undefined when no year is present.
 */
export function extractYear(item: CslJsonItem): string | undefined {
  const y = item.issued?.["date-parts"]?.[0]?.[0];
  return y != null ? String(y) : undefined;
}

/**
 * Format a CSL-JSON author array as a flat string ("Last, First and Last, First").
 * Used for fallback display when the CSL processor is unavailable.
 */
export function formatCslAuthors(
  authors: CslJsonItem["author"],
): string {
  if (!authors || authors.length === 0) return "";
  return authors
    .map((a) => {
      if (a.literal) return a.literal;
      const family = a.family ?? "";
      const given = a.given ?? "";
      if (given) return `${family}, ${given}`;
      return family;
    })
    .join(" and ");
}
