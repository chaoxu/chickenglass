/**
 * BibTeX parser adapter using citation-js (@citation-js/plugin-bibtex).
 *
 * Parses BibTeX content via citation-js (which produces CSL-JSON) and
 * normalizes the output into the flat BibEntry interface used throughout
 * the application.
 */

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";

/** A single parsed BibTeX entry. */
export interface BibEntry {
  /** Citation key, e.g. "karger2000". */
  id: string;
  /** Entry type, e.g. "article", "book", "inproceedings". */
  type: string;
  author?: string;
  title?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  publisher?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  url?: string;
  [field: string]: string | undefined;
}

/** CSL-JSON type mapping back to BibTeX entry types. */
const CSL_TO_BIBTEX_TYPE: Record<string, string> = {
  "article-journal": "article",
  "book": "book",
  "paper-conference": "inproceedings",
  "chapter": "incollection",
  "thesis": "thesis",
  "report": "techreport",
  "document": "misc",
  "manuscript": "unpublished",
  "webpage": "misc",
};

/** CSL-JSON item shape (subset of fields we read). */
interface CslJsonItem {
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

/**
 * Format a CSL-JSON name array back into a BibTeX-style author string.
 * Produces "Last, First and Last, First" format.
 */
function formatCslAuthors(
  authors: Array<{ family?: string; given?: string; literal?: string }>,
): string {
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

/**
 * Convert a CSL-JSON item (from citation-js) into our flat BibEntry interface.
 */
function cslItemToBibEntry(item: CslJsonItem): BibEntry {
  const result: BibEntry = {
    id: (item["citation-key"] as string) ?? item.id,
    type: CSL_TO_BIBTEX_TYPE[item.type] ?? "misc",
  };

  if (item.author && item.author.length > 0) {
    result.author = formatCslAuthors(item.author);
  }
  if (item.title) result.title = item.title;

  // Map container-title back to journal or booktitle based on entry type
  if (item["container-title"]) {
    if (item.type === "article-journal") {
      result.journal = item["container-title"];
    } else {
      result.booktitle = item["container-title"];
    }
  }

  if (item.publisher) result.publisher = item.publisher;
  if (item.volume) result.volume = String(item.volume);
  if (item.issue) result.number = String(item.issue);
  if (item.page) result.pages = item.page;
  if (item.DOI) result.doi = item.DOI;
  if (item.URL) result.url = item.URL;
  if (item.edition) result.edition = String(item.edition);

  if (item.issued?.["date-parts"]?.[0]?.[0] != null) {
    result.year = String(item.issued["date-parts"][0][0]);
  }

  return result;
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
 * Parse BibTeX content into an array of structured entries.
 *
 * Uses citation-js for BibTeX parsing (BibTeX -> CSL-JSON), then maps
 * CSL-JSON items back to the flat BibEntry interface.
 *
 * @param content - The full text content of a .bib file
 * @returns Array of parsed BibEntry objects
 */
export function parseBibTeX(content: string): BibEntry[] {
  if (!content.trim()) return [];

  try {
    const cite = new Cite(content);
    return (cite.data as CslJsonItem[]).map(cslItemToBibEntry);
  } catch (e: unknown) {
    // Malformed BibTeX content -- return empty list rather than crashing
    console.warn("[bibtex] parse failed, returning empty list", e);
    return [];
  }
}

/**
 * Parse a BibTeX author string into structured name objects.
 * Handles "Last, First and Last, First" and "First Last" formats.
 *
 * Shared by CSL conversion (which needs full {family, given} pairs)
 * and extractLastName (which only needs the first author's family name).
 */
export function parseAuthorNames(
  authorStr: string,
): Array<{ family: string; given: string }> {
  return authorStr.split(/\s+and\s+/i).map((name) => {
    const trimmed = name.trim();
    if (trimmed.includes(",")) {
      const [family, given] = trimmed.split(",", 2);
      return { family: family.trim(), given: (given ?? "").trim() };
    }
    // "First Middle Last" -> given="First Middle", family="Last"
    const parts = trimmed.split(/\s+/);
    const family = parts.pop() ?? trimmed;
    return { family, given: parts.join(" ") };
  });
}

/**
 * Extract the last name from a BibTeX author string.
 * Handles "Last, First" and "First Last" formats.
 * For multiple authors, returns the first author's last name.
 */
export function extractLastName(author: string): string {
  return parseAuthorNames(author)[0]?.family ?? author;
}
