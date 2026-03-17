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
    // "First Middle Last" → given="First Middle", family="Last"
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
 * Minimal en-US locale for citeproc.
 * Contains just enough terms for common citation styles.
 */
const EN_US_LOCALE = `<?xml version="1.0" encoding="utf-8"?>
<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="en-US">
  <info><updated>2024-01-01T00:00:00+00:00</updated></info>
  <style-options punctuation-in-quote="true"/>
  <date form="text"><date-part name="month" suffix=" "/><date-part name="day" suffix=", "/><date-part name="year"/></date>
  <date form="numeric"><date-part name="month" form="numeric-leading-zeros" suffix="/"/><date-part name="day" form="numeric-leading-zeros" suffix="/"/><date-part name="year"/></date>
  <terms>
    <term name="and">and</term>
    <term name="et-al">et al.</term>
    <term name="editor" form="short">ed.</term>
    <term name="editor" form="verb-short">ed.</term>
    <term name="edition" form="short">ed.</term>
    <term name="translator" form="short">trans.</term>
    <term name="page" form="short">p.</term>
    <term name="volume" form="short">vol.</term>
    <term name="issue" form="short">no.</term>
    <term name="chapter-number" form="short">chap.</term>
    <term name="retrieved">retrieved</term>
    <term name="from">from</term>
    <term name="in">in</term>
    <term name="accessed">accessed</term>
    <term name="ibid">ibid.</term>
    <term name="presented at">presented at the</term>
    <term name="available at">available at</term>
    <term name="no date" form="short">n.d.</term>
    <term name="reference">
      <single>reference</single>
      <multiple>references</multiple>
    </term>
    <term name="open-quote">\u201c</term>
    <term name="close-quote">\u201d</term>
    <term name="open-inner-quote">\u2018</term>
    <term name="close-inner-quote">\u2019</term>
  </terms>
</locale>`;

/**
 * Default CSL style: Chicago Manual of Style (author-date), simplified.
 * Provides (Author Year) inline citations and a full bibliography.
 */
const DEFAULT_CSL_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0"
       demote-non-dropping-particle="sort-only" default-locale="en-US">
  <info>
    <title>Chicago Author-Date (simplified)</title>
    <id>http://www.zotero.org/styles/chicago-author-date-simplified</id>
    <updated>2024-01-01T00:00:00+00:00</updated>
  </info>

  <macro name="author">
    <names variable="author">
      <name form="short" and="text" delimiter=", " delimiter-precedes-last="never"/>
      <substitute><names variable="editor"/><text variable="title" form="short"/></substitute>
    </names>
  </macro>

  <macro name="author-full">
    <names variable="author">
      <name and="text" delimiter=", " delimiter-precedes-last="always" name-as-sort-order="first"/>
      <substitute><names variable="editor"/><text variable="title"/></substitute>
    </names>
  </macro>

  <macro name="year">
    <date variable="issued"><date-part name="year"/></date>
  </macro>

  <macro name="title">
    <choose>
      <if type="book thesis report" match="any">
        <text variable="title" font-style="italic"/>
      </if>
      <else>
        <text variable="title" quotes="true"/>
      </else>
    </choose>
  </macro>

  <macro name="container">
    <choose>
      <if type="article-journal">
        <group delimiter=" ">
          <text variable="container-title" font-style="italic"/>
          <text variable="volume"/>
          <text variable="issue" prefix="(" suffix=")"/>
        </group>
      </if>
      <else-if type="paper-conference chapter" match="any">
        <group delimiter=" ">
          <text term="in"/>
          <text variable="container-title" font-style="italic"/>
        </group>
      </else-if>
    </choose>
  </macro>

  <citation et-al-min="4" et-al-use-first="1" disambiguate-add-year-suffix="true"
            disambiguate-add-names="true" disambiguate-add-givenname="true">
    <sort><key macro="author"/><key macro="year"/></sort>
    <layout prefix="(" suffix=")" delimiter="; ">
      <group delimiter=", ">
        <text macro="author"/>
        <text macro="year"/>
      </group>
    </layout>
  </citation>

  <bibliography hanging-indent="true" et-al-min="11" et-al-use-first="7"
               entry-spacing="0" subsequent-author-substitute="&#8212;&#8212;&#8212;">
    <sort><key macro="author-full"/><key macro="year"/></sort>
    <layout suffix=".">
      <group delimiter=". ">
        <text macro="author-full"/>
        <text macro="year"/>
        <text macro="title"/>
        <text macro="container"/>
      </group>
      <text variable="page" prefix=": "/>
      <text variable="publisher" prefix=". "/>
    </layout>
  </bibliography>
</style>`;

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
    this.styleXml = styleXml ?? DEFAULT_CSL_STYLE;
    this.initEngine();
  }

  /** Reinitialize the citeproc engine with a new style. */
  setStyle(styleXml: string): void {
    this.styleXml = styleXml;
    this.initEngine();
  }

  /** Format a parenthetical citation for the given ids. */
  cite(ids: string[]): string {
    if (!this.engine || ids.length === 0) return "";
    try {
      const items = ids.map((id) => ({ id }));
      const result = this.engine.makeCitationCluster(items);
      return result;
    } catch {
      // Fallback: simple "Author, Year" format
      return ids
        .map((id) => {
          const item = this.items.get(id);
          if (!item) return id;
          const author = item.author?.[0]?.family ?? id;
          const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
          return `${author}, ${year}`;
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
      return [];
    }
  }

  private initEngine(): void {
    const items = this.items;
    const sys = {
      retrieveLocale(): string {
        return EN_US_LOCALE;
      },
      retrieveItem(id: string): CslItem | undefined {
        return items.get(id);
      },
    };

    try {
      this.engine = new CSL.Engine(sys, this.styleXml);
    } catch {
      this.engine = null;
    }
  }
}
