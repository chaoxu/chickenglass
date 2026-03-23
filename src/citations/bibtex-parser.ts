/**
 * BibTeX parser adapter using citation-js (@citation-js/plugin-bibtex).
 *
 * Parses BibTeX content via citation-js (which produces CSL-JSON) and
 * returns CSL-JSON items directly — no intermediate adapter layer.
 */

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";

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

/** Placeholder tokens for escaped braces during brace stripping. */
const ESCAPED_LB = "\uFFFDLB";
const ESCAPED_RB = "\uFFFDRB";
const RE_ESCAPED_LB = /\uFFFDLB/g;
const RE_ESCAPED_RB = /\uFFFDRB/g;

/**
 * Map of LaTeX accent commands to combining Unicode characters.
 * Supports both `\"u` and `\"{u}` forms.
 */
const ACCENT_MAP: Record<string, Record<string, string>> = {
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü", y: "ÿ", Y: "Ÿ" },
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", y: "ý", Y: "Ý", c: "ć", C: "Ć", n: "ń", N: "Ń", s: "ś", S: "Ś", z: "ź", Z: "Ź" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  "=": { a: "ā", e: "ē", i: "ī", o: "ō", u: "ū", A: "Ā", E: "Ē", I: "Ī", O: "Ō", U: "Ū" },
  ".": { a: "ȧ", c: "ċ", e: "ė", g: "ġ", o: "ȯ", z: "ż", A: "Ȧ", C: "Ċ", E: "Ė", G: "Ġ", I: "İ", O: "Ȯ", Z: "Ż" },
  c: { c: "ç", C: "Ç", s: "ş", S: "Ş", t: "ţ", T: "Ţ" },
  H: { o: "ő", O: "Ő", u: "ű", U: "Ű" },
  v: { s: "š", S: "Š", c: "č", C: "Č", z: "ž", Z: "Ž", r: "ř", R: "Ř", n: "ň", N: "Ň", e: "ě", E: "Ě", d: "ď", D: "Ď", t: "ť", T: "Ť" },
  u: { a: "ă", A: "Ă", g: "ğ", G: "Ğ" },
  r: { a: "å", A: "Å", u: "ů", U: "Ů" },
  d: { a: "ạ", A: "Ạ", e: "ẹ", E: "Ẹ", o: "ọ", O: "Ọ", u: "ụ", U: "Ụ" },
  k: { a: "ą", A: "Ą", e: "ę", E: "Ę" },
};

/**
 * Clean BibTeX field text by stripping protective braces and converting
 * LaTeX accent commands to Unicode.
 *
 * Handles both `\"u` and `\"{u}` forms for symbol accents,
 * and `\c{c}` form for letter accents.
 */
export function cleanBibtex(text: string): string {
  // Step 1: Convert LaTeX accents to Unicode
  // Handle \cmd{char} form (works for both symbol and letter accent commands)
  let result = text.replace(
    /\\(["'`~^=.cHvurdk])\{([a-zA-Z])\}/g,
    (match, cmd: string, ch: string) => {
      return ACCENT_MAP[cmd]?.[ch] ?? match;
    },
  );

  // Handle \cmd<char> form (only for symbol accent commands like \" \' \` \~ \^ \= \.)
  result = result.replace(
    /\\(["'`~^=.])([a-zA-Z])/g,
    (match, cmd: string, ch: string) => {
      return ACCENT_MAP[cmd]?.[ch] ?? match;
    },
  );

  // Step 2: Strip braces (but preserve escaped braces \{ and \})
  // Replace escaped braces with placeholders, then strip, then restore
  result = result.replace(/\\\{/g, ESCAPED_LB);
  result = result.replace(/\\\}/g, ESCAPED_RB);
  result = result.replace(/[{}]/g, "");
  result = result.replace(RE_ESCAPED_LB, "{");
  result = result.replace(RE_ESCAPED_RB, "}");

  return result;
}

/**
 * Normalize a CSL-JSON item from citation-js: use citation-key as id when present.
 */
function normalizeCslItem(item: CslJsonItem): CslJsonItem {
  const citationKey = item["citation-key"] as string | undefined;
  if (citationKey && citationKey !== item.id) {
    return { ...item, id: citationKey };
  }
  return item;
}

/**
 * Parse BibTeX content into an array of CSL-JSON items.
 *
 * Uses citation-js for BibTeX parsing (BibTeX -> CSL-JSON).
 * The citation-key is promoted to id when present.
 *
 * @param content - The full text content of a .bib file
 * @returns Array of parsed CslJsonItem objects
 */
export function parseBibTeX(content: string): CslJsonItem[] {
  if (!content.trim()) return [];

  try {
    const cite = new Cite(content);
    return (cite.data as CslJsonItem[]).map(normalizeCslItem);
  } catch (e: unknown) {
    // Malformed BibTeX content -- return empty list rather than crashing
    console.warn("[bibtex] parse failed, returning empty list", e);
    return [];
  }
}

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
