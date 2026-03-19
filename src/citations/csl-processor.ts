/**
 * CSL (Citation Style Language) processor.
 *
 * Wraps citeproc-js to format citations and bibliographies according to
 * a CSL style. Converts BibEntry objects to CSL-JSON, processes them
 * through citeproc, and returns formatted HTML strings.
 *
 * Usage:
 *   const processor = new CslProcessor(items);
 *   processor.setStyle(cslXml);       // optional: custom CSL style
 *   const cite = processor.cite(["karger2000"]);
 *   const bib = processor.bibliography();
 */

// @ts-expect-error citeproc has no type declarations
import CSL from "citeproc";
import type { BibEntry } from "./bibtex-parser";
import enUsLocale from "./en-us-locale.xml?raw";
import defaultCslStyle from "./ieee.csl?raw";

/** CSL-JSON item (subset of fields used by citeproc). */
export interface CslItem {
  id: string;
  type: string;
  author?: Array<{ family: string; given: string }>;
  title?: string;
  "container-title"?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  issued?: { "date-parts": number[][] };
  edition?: string;
  [key: string]: unknown;
}

/** Pandoc-style locator label terms mapped to CSL locator labels. */
const LOCATOR_TERMS: ReadonlyMap<string, string> = new Map([
  ["book", "book"], ["bk.", "book"], ["bks.", "book"],
  ["chapter", "chapter"], ["chap.", "chapter"], ["chaps.", "chapter"],
  ["column", "column"], ["col.", "column"], ["cols.", "column"],
  ["figure", "figure"], ["fig.", "figure"], ["figs.", "figure"],
  ["folio", "folio"], ["fol.", "folio"], ["fols.", "folio"],
  ["number", "number"], ["no.", "number"], ["nos.", "number"],
  ["line", "line"], ["l.", "line"], ["ll.", "line"],
  ["note", "note"], ["n.", "note"], ["nn.", "note"],
  ["opus", "opus"], ["op.", "opus"], ["opp.", "opus"],
  ["page", "page"], ["p.", "page"], ["pp.", "page"],
  ["paragraph", "paragraph"], ["para.", "paragraph"], ["paras.", "paragraph"],
  ["part", "part"], ["pt.", "part"], ["pts.", "part"],
  ["section", "section"], ["sec.", "section"], ["secs.", "section"],
  ["sub verbo", "sub-verbo"], ["s.v.", "sub-verbo"], ["s.vv.", "sub-verbo"],
  ["verse", "verse"], ["v.", "verse"], ["vv.", "verse"],
  ["volume", "volume"], ["vol.", "volume"], ["vols.", "volume"],
]);

/** Sorted keys for matching (longest first to avoid prefix conflicts). */
const SORTED_LOCATOR_KEYS = [...LOCATOR_TERMS.keys()].sort(
  (a, b) => b.length - a.length,
);

/**
 * Parse a Pandoc-style locator string into a CSL label and locator value.
 * E.g. "chap. 36" → { label: "chapter", locator: "36" }
 * E.g. "pp. 100-120" → { label: "page", locator: "100-120" }
 * E.g. "theorem 3" → { locator: "theorem 3" } (no recognized label)
 */
export function parseLocator(raw: string): { locator: string; label?: string } {
  const text = raw.trim();

  for (const prefix of SORTED_LOCATOR_KEYS) {
    if (text.toLowerCase().startsWith(prefix)) {
      const rest = text.slice(prefix.length).trim();
      if (rest) {
        return { locator: rest, label: LOCATOR_TERMS.get(prefix) };
      }
    }
  }

  return { locator: text };
}

/** Map from BibTeX entry types to CSL types. */
const BIBTEX_TO_CSL_TYPE: Record<string, string> = {
  article: "article-journal",
  book: "book",
  inproceedings: "paper-conference",
  incollection: "chapter",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  techreport: "report",
  misc: "document",
  unpublished: "manuscript",
  proceedings: "book",
};

/** Parse a BibTeX author string into CSL name objects. */
function parseAuthors(
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

/** Convert a BibEntry to a CSL-JSON item. */
export function bibEntryToCsl(entry: BibEntry): CslItem {
  const item: CslItem = {
    id: entry.id,
    type: BIBTEX_TO_CSL_TYPE[entry.type] ?? "document",
  };

  if (entry.author) item.author = parseAuthors(entry.author);
  if (entry.title) item.title = entry.title;
  if (entry.journal) item["container-title"] = entry.journal;
  if (entry.booktitle) item["container-title"] = entry.booktitle;
  if (entry.publisher) item.publisher = entry.publisher;
  if (entry.volume) item.volume = entry.volume;
  if (entry.number) item.issue = entry.number;
  if (entry.pages) item.page = entry.pages.replace("--", "-");
  if (entry.doi) item.DOI = entry.doi;
  if (entry.url) item.URL = entry.url;
  if (entry.edition) item.edition = entry.edition;

  if (entry.year) {
    const y = parseInt(entry.year, 10);
    if (!isNaN(y)) item.issued = { "date-parts": [[y]] };
  }

  return item;
}

/**
 * CSL citation processor.
 *
 * Wraps citeproc-js with a simple API for formatting citations
 * and bibliographies from BibEntry data.
 */
export class CslProcessor {
  private items: Map<string, CslItem>;
  private engine: ReturnType<typeof CSL.Engine> | null = null;
  private styleXml: string;

  constructor(entries: BibEntry[], styleXml?: string) {
    this.items = new Map();
    for (const entry of entries) {
      const csl = bibEntryToCsl(entry);
      this.items.set(csl.id, csl);
    }
    this.styleXml = styleXml ?? defaultCslStyle;
    this.initEngine();
  }

  /** Reinitialize the citeproc engine with a new style. */
  setStyle(styleXml: string): void {
    this.styleXml = styleXml;
    this.initEngine();
  }

  /**
   * Register all citations in order so numeric styles can assign numbers.
   * Call this once with every citation cluster before calling cite().
   */
  registerCitations(clusters: Array<{ ids: string[]; locators?: (string | undefined)[] }>): void {
    if (!this.engine) return;
    this.engine.updateItems([]);
    const allIds = new Set<string>();
    for (const cluster of clusters) {
      for (const id of cluster.ids) allIds.add(id);
    }
    this.engine.updateItems([...allIds]);

    // Process citations in order so the engine assigns numbers
    const citationsPre: Array<[string, number]> = [];
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const citationItems = cluster.ids.map((id, j) => {
        const raw = cluster.locators?.[j];
        if (raw) {
          const parsed = parseLocator(raw);
          return { id, locator: parsed.locator, label: parsed.label };
        }
        return { id };
      });
      const citation = {
        citationItems,
        properties: { noteIndex: 0 },
        citationID: `cite-${i}`,
      };
      try {
        this.engine.processCitationCluster(citation, citationsPre, []);
      } catch {
        // ignore individual cluster errors
      }
      citationsPre.push([`cite-${i}`, i]);
    }
  }

  /** Format a parenthetical citation for the given ids, with optional locators. */
  cite(ids: string[], locators?: (string | undefined)[]): string {
    if (!this.engine || ids.length === 0) return "";
    try {
      const items = ids.map((id, i) => {
        const raw = locators?.[i];
        if (raw) {
          const parsed = parseLocator(raw);
          return { id, locator: parsed.locator, label: parsed.label };
        }
        return { id };
      });
      const result = this.engine.makeCitationCluster(items);
      return result;
    } catch {
      // Fallback: simple "Author, Year" format
      return ids
        .map((id, i) => {
          const item = this.items.get(id);
          if (!item) return id;
          const author = item.author?.[0]?.family ?? id;
          const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
          const locator = locators?.[i];
          let text = `${author}, ${year}`;
          if (locator) text += `, ${locator}`;
          return text;
        })
        .join("; ");
    }
  }

  /** Format a narrative citation for a single id. */
  citeNarrative(id: string): string {
    const item = this.items.get(id);
    if (!item) return id;
    // citeproc doesn't have a direct narrative mode —
    // we extract author and year separately
    const author = item.author?.map((a) => a.family).join(", ") ?? id;
    const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
    try {
      if (this.engine) {
        const cluster = this.engine.makeCitationCluster([{ id }]);
        // Extract year portion from the cluster result (inside parentheses)
        const yearMatch = /\(([^)]+)\)/.exec(cluster) ?? /,\s*(.+)$/.exec(cluster);
        if (yearMatch) {
          return `${author} (${yearMatch[1]})`;
        }
      }
    } catch {
      // Fall through to simple format
    }
    return `${author} (${year})`;
  }

  /**
   * Generate the full bibliography as an array of formatted HTML strings.
   * Each entry is an HTML string (may contain <i>, <span>, etc.).
   */
  bibliography(): string[] {
    if (!this.engine) return [];
    try {
      this.engine.updateItems([...this.items.keys()]);
      const [, entries] = this.engine.makeBibliography() as [unknown, string[]];
      return entries.map((e: string) => e.trim());
    } catch {
      // CSL engine may fail on malformed entries — return empty bibliography
      return [];
    }
  }

  private initEngine(): void {
    const items = this.items;
    const sys = {
      retrieveLocale(): string {
        return enUsLocale;
      },
      retrieveItem(id: string): CslItem | undefined {
        return items.get(id);
      },
    };

    try {
      this.engine = new CSL.Engine(sys, this.styleXml);
    } catch {
      // Invalid or unsupported CSL style XML — disable engine, fall back to simple formatting
      this.engine = null;
    }
  }
}
