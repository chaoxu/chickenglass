import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";

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

const ESCAPED_LB = "\uFFFDLB";
const ESCAPED_RB = "\uFFFDRB";
const RE_ESCAPED_LB = /\uFFFDLB/g;
const RE_ESCAPED_RB = /\uFFFDRB/g;

const ACCENT_MAP: Record<string, Record<string, string>> = {
  "\"": { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü", y: "ÿ", Y: "Ÿ" },
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

const NON_CITATION_FIELD_NAMES = new Set(["abstract", "file"]);
const RE_BIB_FIELD_CHAR = /[A-Za-z0-9_-]/;
const bibParseCache = new Map<string, CslJsonItem[]>();
const BIB_PARSE_CACHE_MAX = 4;

function isBibFieldChar(ch: string): boolean {
  return RE_BIB_FIELD_CHAR.test(ch);
}

function consumeBibBracedValue(text: string, start: number): number {
  let depth = 0;
  let index = start;

  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }

  return text.length;
}

function consumeBibQuotedValue(text: string, start: number): number {
  let index = start + 1;

  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\"") {
      return index + 1;
    }
    index += 1;
  }

  return text.length;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && (text[index] === " " || text[index] === "\t" || text[index] === "\r")) {
    index += 1;
  }
  return index;
}

function tryStripField(content: string, lineStart: number): number {
  let index = skipWhitespace(content, lineStart);
  const nameStart = index;

  while (index < content.length && isBibFieldChar(content[index])) {
    index += 1;
  }

  const fieldName = content.slice(nameStart, index).toLowerCase();
  index = skipWhitespace(content, index);

  if (!NON_CITATION_FIELD_NAMES.has(fieldName) || content[index] !== "=") {
    return -1;
  }

  index = skipWhitespace(content, index + 1);

  if (content[index] === "{") {
    index = consumeBibBracedValue(content, index);
  } else if (content[index] === "\"") {
    index = consumeBibQuotedValue(content, index);
  } else {
    while (index < content.length && content[index] !== "," && content[index] !== "\n") {
      index += 1;
    }
  }

  index = skipWhitespace(content, index);
  if (content[index] === ",") {
    index += 1;
  }
  return index;
}

function stripIrrelevantBibFields(content: string): string {
  const kept: string[] = [];
  let index = 0;

  while (index < content.length) {
    const skipTo = tryStripField(content, index);
    if (skipTo >= 0) {
      index = skipTo;
      continue;
    }

    const lineEnd = content.indexOf("\n", index);
    if (lineEnd < 0) {
      kept.push(content.slice(index));
      break;
    }
    kept.push(content.slice(index, lineEnd + 1));
    index = lineEnd + 1;
  }

  return kept.join("");
}

function normalizeCslItem(item: CslJsonItem): CslJsonItem {
  const citationKey = item["citation-key"];
  if (typeof citationKey === "string" && citationKey !== item.id) {
    return {
      ...item,
      id: citationKey,
    };
  }
  return item;
}

function cacheBibParseResult(content: string, result: CslJsonItem[]): void {
  while (bibParseCache.size >= BIB_PARSE_CACHE_MAX) {
    const oldest = bibParseCache.keys().next();
    if (oldest.done) {
      bibParseCache.clear();
      break;
    }
    bibParseCache.delete(oldest.value);
  }
  bibParseCache.set(content, result);
}

export function cleanBibtex(text: string): string {
  let result = text.replace(
    /\\(["'`~^=.cHvurdk])\{([a-zA-Z])\}/g,
    (match, cmd: string, char: string) => ACCENT_MAP[cmd]?.[char] ?? match,
  );

  result = result.replace(
    /\\(["'`~^=.])([a-zA-Z])/g,
    (match, cmd: string, char: string) => ACCENT_MAP[cmd]?.[char] ?? match,
  );

  result = result.replace(/\\\{/g, ESCAPED_LB);
  result = result.replace(/\\\}/g, ESCAPED_RB);
  result = result.replace(/[{}]/g, "");
  result = result.replace(RE_ESCAPED_LB, "{");
  result = result.replace(RE_ESCAPED_RB, "}");

  return result;
}

export function parseBibTeX(content: string): CslJsonItem[] {
  if (!content.trim()) {
    return [];
  }

  const cached = bibParseCache.get(content);
  if (cached) {
    return cached;
  }

  try {
    const cite = new Cite(content);
    const result = (cite.data as CslJsonItem[]).map(normalizeCslItem);
    cacheBibParseResult(content, result);
    return result;
  } catch (error) {
    const sanitized = stripIrrelevantBibFields(content);
    if (sanitized !== content) {
      try {
        const cite = new Cite(sanitized);
        const result = (cite.data as CslJsonItem[]).map(normalizeCslItem);
        cacheBibParseResult(content, result);
        return result;
      } catch (retryError) {
        console.warn("[bibtex] parse failed after stripping abstract/file fields", retryError);
        return [];
      }
    }

    console.warn("[bibtex] parse failed", error);
    return [];
  }
}

export function clearBibParseCache(): void {
  bibParseCache.clear();
}

export function extractFirstFamilyName(
  authors: CslJsonItem["author"],
  fallback: string,
): string {
  if (!authors || authors.length === 0) {
    return fallback;
  }
  const first = authors[0];
  return first.literal ?? first.family ?? fallback;
}

export function extractYear(item: CslJsonItem): string | undefined {
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return year != null ? String(year) : undefined;
}

export function formatCslAuthors(authors: CslJsonItem["author"]): string {
  if (!authors || authors.length === 0) {
    return "";
  }

  return authors
    .map((author) => {
      if (author.literal) {
        return author.literal;
      }
      const family = author.family ?? "";
      const given = author.given ?? "";
      return given ? `${family}, ${given}` : family;
    })
    .join(" and ");
}
