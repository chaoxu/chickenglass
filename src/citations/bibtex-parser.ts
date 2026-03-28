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

const NON_CITATION_FIELD_NAMES = new Set(["abstract", "file"]);

const RE_BIB_FIELD_CHAR = /[A-Za-z0-9_-]/;
function isBibFieldChar(ch: string): boolean {
  return RE_BIB_FIELD_CHAR.test(ch);
}

function consumeBibBracedValue(text: string, start: number): number {
  let depth = 0;
  let i = start;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }

  return text.length;
}

function consumeBibQuotedValue(text: string, start: number): number {
  let i = start + 1;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\"") return i + 1;
    i += 1;
  }

  return text.length;
}

/** Skip whitespace (space, tab, CR) starting at `pos`. */
function skipWs(text: string, pos: number): number {
  while (pos < text.length && (text[pos] === " " || text[pos] === "\t" || text[pos] === "\r")) pos++;
  return pos;
}

/**
 * Check if a line starts a BibTeX field we want to strip (abstract, file).
 * Returns the position past the field value + trailing comma, or -1 if not a match.
 */
function tryStripField(content: string, lineStart: number): number {
  let pos = skipWs(content, lineStart);

  const nameStart = pos;
  while (pos < content.length && isBibFieldChar(content[pos])) pos++;
  const fieldName = content.slice(nameStart, pos).toLowerCase();

  pos = skipWs(content, pos);
  if (!NON_CITATION_FIELD_NAMES.has(fieldName) || content[pos] !== "=") return -1;

  pos = skipWs(content, pos + 1);

  if (content[pos] === "{") {
    pos = consumeBibBracedValue(content, pos);
  } else if (content[pos] === "\"") {
    pos = consumeBibQuotedValue(content, pos);
  } else {
    while (pos < content.length && content[pos] !== "," && content[pos] !== "\n") pos++;
  }

  pos = skipWs(content, pos);
  if (content[pos] === ",") pos++;
  return pos;
}

/**
 * Strip metadata fields that are irrelevant for citation rendering but
 * commonly contain malformed exporter output (for example Zotero abstracts).
 * Works line-by-line: keeps lines as slices, strips matching fields entirely.
 */
function stripIrrelevantBibFields(content: string): string {
  const kept: string[] = [];
  let i = 0;

  while (i < content.length) {
    const skipTo = tryStripField(content, i);
    if (skipTo >= 0) {
      i = skipTo;
      continue;
    }
    // Keep this line — find the end and slice it
    const eol = content.indexOf("\n", i);
    if (eol < 0) {
      kept.push(content.slice(i));
      break;
    }
    kept.push(content.slice(i, eol + 1));
    i = eol + 1;
  }

  return kept.join("");
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
 * Content-keyed cache for parsed BibTeX results.
 * Bounded to avoid unbounded memory growth from many distinct inputs.
 */
const bibParseCache = new Map<string, CslJsonItem[]>();
const BIB_PARSE_CACHE_MAX = 4;

function cacheBibParseResult(content: string, result: CslJsonItem[]): void {
  if (bibParseCache.size >= BIB_PARSE_CACHE_MAX) {
    const oldest = bibParseCache.keys().next().value;
    if (oldest !== undefined) bibParseCache.delete(oldest);
  }
  bibParseCache.set(content, result);
}

/**
 * Parse BibTeX content into an array of CSL-JSON items.
 *
 * Uses citation-js for BibTeX parsing (BibTeX -> CSL-JSON).
 * The citation-key is promoted to id when present.
 * Results are cached by content string so repeated calls with
 * identical input skip the expensive parse.
 *
 * @param content - The full text content of a .bib file
 * @returns Array of parsed CslJsonItem objects
 */
export function parseBibTeX(content: string): CslJsonItem[] {
  if (!content.trim()) return [];

  const cached = bibParseCache.get(content);
  if (cached) return cached;

  try {
    const cite = new Cite(content);
    const result = (cite.data as CslJsonItem[]).map(normalizeCslItem);
    cacheBibParseResult(content, result);
    return result;
  } catch (e: unknown) {
    const sanitized = stripIrrelevantBibFields(content);
    if (sanitized !== content) {
      try {
        const cite = new Cite(sanitized);
        const result = (cite.data as CslJsonItem[]).map(normalizeCslItem);
        cacheBibParseResult(content, result);
        return result;
      } catch (retryError: unknown) {
        console.warn("[bibtex] parse failed after stripping abstract/file fields, returning empty list", retryError);
        return [];
      }
    }

    // Malformed BibTeX content -- return empty list rather than crashing
    console.warn("[bibtex] parse failed, returning empty list", e);
    return [];
  }
}

/** Clear the parse cache (exposed for testing). */
export function clearBibParseCache(): void {
  bibParseCache.clear();
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
