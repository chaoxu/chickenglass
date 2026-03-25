/**
 * CSL (Citation Style Language) processor.
 *
 * Wraps citation-js (@citation-js/core + @citation-js/plugin-csl) to format
 * citations and bibliographies according to a CSL style. Accepts CSL-JSON
 * items directly (no intermediate adapter), processes them through citeproc
 * (via citation-js), and returns formatted HTML strings.
 *
 * Usage:
 *   const processor = new CslProcessor(items);
 *   processor.setStyle(cslXml);       // optional: custom CSL style
 *   const cite = processor.cite(["karger2000"]);
 *   const bib = processor.bibliography(["karger2000"]);
 */

import { plugins, type CiteprocEngine } from "@citation-js/core";
import "@citation-js/plugin-csl";
import { type CslJsonItem } from "./bibtex-parser";
import defaultCslStyle from "./ieee.csl?raw";

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
 * E.g. "chap. 36" -> { label: "chapter", locator: "36" }
 * E.g. "pp. 100-120" -> { label: "page", locator: "100-120" }
 * E.g. "theorem 3" -> { locator: "theorem 3" } (no recognized label)
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

/** Unique template name used to register the active CSL style with citation-js. */
const STYLE_NAME = "coflat-active";

type CompositeCitationCall = (
  citation: {
    citationItems: Array<{ id: string }>;
    properties: {
      noteIndex: number;
      mode: "composite";
      infix: string;
    };
    citationID: string;
  },
  citationsPre: Array<[string, number]>,
  citationsPost: Array<[string, number]>,
) => [unknown, Array<[number, string, string]>];

function formatNarrativeAuthor(item: CslJsonItem): string {
  const authors = item.author ?? [];
  if (authors.length === 0) return item.id;
  return authors
    .map((author) => {
      // Corporate authors are represented with a `literal` field only.
      // Prefer `literal` → `family` → `given` to avoid producing "undefined"
      // for partially-populated entries. Fall back to the item id so the
      // output is always a non-empty, printable string.
      const name = author.literal ?? author.family ?? author.given;
      return name != null && name !== "" ? name : item.id;
    })
    .join(", ");
}

/**
 * CSL citation processor.
 *
 * Wraps citation-js with a simple API for formatting citations
 * and bibliographies from CSL-JSON data.
 */
export class CslProcessor {
  private items: Map<string, CslJsonItem>;
  private engine: CiteprocEngine | null = null;
  private styleXml: string;
  private engineRevision = 0;

  constructor(entries: CslJsonItem[], styleXml?: string) {
    this.items = new Map();
    for (const item of entries) {
      this.items.set(item.id, item);
    }
    this.styleXml = styleXml ?? defaultCslStyle;
    // Skip engine initialization when there are no entries. The citeproc
    // engine cache (`@citation-js/plugin-csl`) is keyed by style+locale,
    // so creating an empty engine replaces the `retrieveItem` callback on
    // any previously cached engine with the same key — corrupting engines
    // that hold real data. All methods already guard `!this.engine`. (#422)
    if (this.items.size > 0) {
      this.initEngine();
    }
  }

  /** Create an empty processor with no entries. */
  static empty(): CslProcessor {
    return new CslProcessor([]);
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
        citationsPre.push([`cite-${i}`, i]);
      } catch (e: unknown) {
        // best-effort: skip malformed cluster so remaining citations still render
        console.warn("[csl] cluster error for cite-" + i, e);
      }
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
      return this.engine.makeCitationCluster(items);
    } catch (e: unknown) {
      // Engine error — return raw ids as fallback
      console.warn("[csl] cite() engine error", e);
      return `(${ids.join("; ")})`;
    }
  }

  /**
   * Format a narrative citation for a single id.
   *
   * Prefer citeproc's composite citation mode, which yields style-aware
   * narrative output such as `Karger (2000)` for author-date styles.
   * Numeric styles like IEEE often do not print an author-only form, so we
   * fall back to `author + suppress-author cite` (e.g. `Karger [1]`).
   */
  citeNarrative(id: string): string {
    const item = this.items.get(id);
    if (!item) return id;
    const author = formatNarrativeAuthor(item);
    try {
      if (this.engine) {
        const compositeEngine = this.engine as unknown as {
          processCitationCluster: CompositeCitationCall;
          makeCitationCluster: (items: Array<Record<string, unknown>>) => string;
        };
        const composite = compositeEngine.processCitationCluster(
          {
            citationItems: [{ id }],
            properties: {
              noteIndex: 0,
              mode: "composite",
              infix: "",
            },
            citationID: `narrative-${id}`,
          },
          [],
          [],
        );
        const rendered = composite?.[1]?.[0]?.[1]?.trim();
        if (rendered && !rendered.includes("[NO_PRINTED_FORM]")) {
          return rendered;
        }

        const suppressed = compositeEngine.makeCitationCluster([
          { id, "suppress-author": true },
        ]).trim();
        if (suppressed) {
          return `${author} ${suppressed}`;
        }
      }
    } catch (e: unknown) {
      // best-effort: fall through to simple author + year format
      console.warn("[csl] citeNarrative() engine error", e);
    }
    const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
    return `${author} (${year})`;
  }

  /**
   * Generate the bibliography as an array of formatted HTML strings.
   * Only includes entries for the given cited IDs (in order).
   * Each entry is an HTML string (may contain <i>, <span>, etc.).
   */
  bibliography(citedIds: string[]): string[] {
    if (!this.engine || citedIds.length === 0) return [];
    try {
      const validIds = citedIds.filter((id) => this.items.has(id));
      if (validIds.length === 0) return [];
      const [, entries] = this.engine.makeBibliography();
      return entries.map((e: string) => e.trim());
    } catch (e: unknown) {
      // CSL engine may fail on malformed entries -- return empty bibliography
      console.warn("[csl] bibliography() engine error", e);
      return [];
    }
  }

  get revision(): number {
    return this.engineRevision;
  }

  private initEngine(): void {
    try {
      const cslConfig = plugins.config.get("@csl");
      cslConfig.templates.add(STYLE_NAME, this.styleXml);
      const data = [...this.items.values()];
      this.engine = cslConfig.engine(data, STYLE_NAME, "en-US", "html");
    } catch (e: unknown) {
      // Invalid or unsupported CSL style XML -- disable engine, fall back to simple formatting
      console.warn("[csl] initEngine() failed, falling back to simple formatting", e);
      this.engine = null;
    } finally {
      this.engineRevision += 1;
    }
  }
}

/**
 * Register citation matches with a CSL processor in document order.
 *
 * Both the CM6 editor (citation-render.ts) and the HTML exporter
 * (markdown-to-html.ts) need this step so numeric styles assign numbers
 * in document order. Extracted here to avoid duplication.
 */
export function registerCitationsWithProcessor(
  matches: ReadonlyArray<{
    ids: readonly string[];
    locators?: readonly (string | undefined)[];
  }>,
  processor: CslProcessor,
): void {
  const clusters = matches
    .map((m) => ({
      ids: [...m.ids],
      locators: m.locators ? [...m.locators] : undefined,
    }));
  processor.registerCitations(clusters);
}
