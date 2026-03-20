/**
 * BibTeX parser adapter using @retorquere/bibtex-parser.
 *
 * Normalizes the library's rich output into the flat BibEntry interface
 * used throughout the application.
 */

import { parse, type Entry, type Creator } from "@retorquere/bibtex-parser";

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

/**
 * Format a Creator array back into a BibTeX-style author string.
 * Produces "Last, First and Last, First" format.
 */
function formatCreators(creators: Creator[]): string {
  return creators
    .map((c) => {
      if (c.name) return c.name;
      const parts: string[] = [];
      if (c.prefix) parts.push(c.prefix);
      if (c.lastName) parts.push(c.lastName);
      if (c.firstName) {
        return `${parts.join(" ")}, ${c.firstName}`;
      }
      return parts.join(" ");
    })
    .join(" and ");
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

/** Fields where the library returns Creator[] instead of string. */
const CREATOR_FIELDS = new Set([
  "author", "bookauthor", "collaborator", "commentator", "director",
  "editor", "editora", "editorb", "editors", "holder",
  "scriptwriter", "translator",
]);

/** Fields where the library returns string[] instead of string. */
const ARRAY_FIELDS = new Set([
  "keywords", "institution", "publisher", "origpublisher",
  "organization", "location", "origlocation",
]);

/**
 * Convert a library Entry into our flat BibEntry interface.
 */
function toBibEntry(entry: Entry): BibEntry {
  const result: BibEntry = {
    id: entry.key,
    type: entry.type.toLowerCase(),
  };

  for (const [key, value] of Object.entries(entry.fields)) {
    if (value === undefined || value === null) continue;

    if (CREATOR_FIELDS.has(key) && Array.isArray(value)) {
      result[key] = cleanBibtex(formatCreators(value as Creator[]));
    } else if (ARRAY_FIELDS.has(key) && Array.isArray(value)) {
      result[key] = cleanBibtex((value as string[]).join(" and "));
    } else if (typeof value === "string") {
      result[key] = cleanBibtex(value);
    }
  }

  return result;
}

/**
 * Parse BibTeX content into an array of structured entries.
 *
 * @param content - The full text content of a .bib file
 * @returns Array of parsed BibEntry objects
 */
export function parseBibTeX(content: string): BibEntry[] {
  if (!content.trim()) return [];

  try {
    const library = parse(content, {
      english: false,
      raw: true,
    });
    return library.entries.map(toBibEntry);
  } catch {
    // Malformed BibTeX content — return empty list rather than crashing
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
