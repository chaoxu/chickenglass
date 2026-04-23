/**
 * CSL (Citation Style Language) processor.
 *
 * Wraps citation-js (@citation-js/core + @citation-js/plugin-csl) to format
 * citations and bibliographies according to a CSL style. Accepts CSL-JSON
 * items directly (no intermediate adapter), processes them through citeproc
 * (via citation-js), and returns formatted HTML strings.
 *
 * Usage:
 *   const processor = await CslProcessor.create(items);
 *   await processor.setStyle(cslXml);  // optional: custom CSL style
 *   const cite = processor.cite(["karger2000"]);
 *   const bib = processor.bibliography(["karger2000"]);
 */

import type { ReferenceIndexModel } from "../references/model";
import { type CslJsonItem } from "./bibtex-parser";
import defaultCslStyle from "./ieee.csl?raw";

/**
 * Lazily-loaded citation-js modules.
 *
 * `@citation-js/core` (~60 KB) and `@citation-js/plugin-csl` (~435 KB via
 * citeproc) are only needed when a document actually has citations.  By
 * dynamic-importing them here and caching the result we keep them out of
 * the main startup chunk entirely.  (#446)
 */
export interface CitationJsModules {
  plugins: typeof import("@citation-js/core").plugins;
}

export type CitationJsLoader = () => Promise<CitationJsModules>;

let citationJsPromise: Promise<CitationJsModules> | null = null;
let citationJsLoaderOverride: CitationJsLoader | null = null;

function loadCitationJs(): Promise<CitationJsModules> {
  if (!citationJsPromise) {
    citationJsPromise = (citationJsLoaderOverride ?? (async () => {
      const [core] = await Promise.all([
        import("@citation-js/core"),
        // Side-effect import: registers the CSL plugin with citation-js
        import("@citation-js/plugin-csl"),
      ]);
      return { plugins: core.plugins };
    }))();
  }
  return citationJsPromise;
}

export function setCitationJsLoaderForTest(loader: CitationJsLoader | null): void {
  citationJsPromise = null;
  citationJsLoaderOverride = loader;
}

/** CiteprocEngine type from @citation-js/core (replicated to avoid static import). */
type CiteprocEngine = import("@citation-js/core").CiteprocEngine;

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

/**
 * Build CitationItem objects from parallel id/locator arrays.
 *
 * Both `registerCitations` and `cite` need to convert raw locator strings
 * into citeproc CitationItem objects with parsed label/locator fields.
 * Centralised here to avoid duplicating the parseLocator dispatch.
 */
function buildCitationItems(
  ids: readonly string[],
  locators?: readonly (string | undefined)[],
): Array<{ id: string; locator?: string; label?: string }> {
  return ids.map((id, i) => {
    const raw = locators?.[i];
    if (raw) {
      const parsed = parseLocator(raw);
      return { id, locator: parsed.locator, label: parsed.label };
    }
    return { id };
  });
}

function serializeKeyPart(value: string | undefined): string {
  return value ?? "";
}

export interface CitationCluster {
  readonly ids: readonly string[];
  readonly locators?: readonly (string | undefined)[];
}

export function getCitationRegistrationKey(
  clusters: readonly CitationCluster[],
): string {
  return clusters
    .map((cluster) => cluster.ids.map((id, index) =>
      `${id}\0${serializeKeyPart(cluster.locators?.[index])}`).join("\u0001"))
    .join("\u0002");
}

let nextProcessorId = 0;

function getStyleName(processorId: number, styleGeneration: number): string {
  return `coflat-${processorId}-${styleGeneration}`;
}

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
  // Registration state is shared across rich mode and preview
  // surfaces that reuse the same processor instance.
  private registeredCitationKey: string | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly processorId = nextProcessorId++;
  private styleGeneration = 0;

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
      this.initPromise = this.initEngine();
    }
  }

  /** Create an empty processor with no entries (never loads citeproc). */
  static empty(): CslProcessor {
    return new CslProcessor([]);
  }

  /**
   * Async factory: creates a processor and waits for citeproc to load.
   * Use this in async contexts so the engine is ready before first use.
   */
  static async create(entries: CslJsonItem[], styleXml?: string): Promise<CslProcessor> {
    const p = new CslProcessor(entries, styleXml);
    await p.ensureReady();
    return p;
  }

  /**
   * Wait until the citeproc engine has finished loading (no-op for empty
   * processors). Callers in async contexts should await this before
   * dispatching the processor into synchronous render paths.
   */
  async ensureReady(): Promise<void> {
    await this.waitForLatestInit(this.initPromise);
  }

  /** Reinitialize the citeproc engine with a new style. */
  async setStyle(styleXml: string): Promise<void> {
    this.styleXml = styleXml;
    this.styleGeneration += 1;
    const styleGeneration = this.styleGeneration;
    const previousInit = this.initPromise ?? Promise.resolve();
    const initPromise = previousInit.catch(() => undefined).then(async () => {
      if (styleGeneration !== this.styleGeneration) return;
      await this.initEngine(styleGeneration, styleXml);
    });
    this.initPromise = initPromise;
    await this.waitForLatestInit(initPromise);
  }

  /**
   * Register all citations in order so numeric styles can assign numbers.
   * Call this once with every citation cluster before calling cite().
   */
  registerCitations(clusters: CitationCluster[]): void {
    this.registeredCitationKey = null;
    if (!this.engine) return;

    const registrationKey = getCitationRegistrationKey(clusters);
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
      const citationItems = buildCitationItems(cluster.ids, cluster.locators);
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

    this.registeredCitationKey = registrationKey;
  }

  /** Format a parenthetical citation for the given ids, with optional locators. */
  cite(ids: string[], locators?: (string | undefined)[]): string {
    if (!this.engine || ids.length === 0) return "";
    try {
      const items = buildCitationItems(ids, locators);
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
   * Uses only `makeCitationCluster` (stateless) to avoid mutating the engine's
   * citation registry. The old `processCitationCluster` approach registered a
   * phantom citation that corrupted numbering for subsequent `cite()` calls.
   * See #498.
   *
   * Strategy: try `author-only` mode first (works for author-date styles like
   * APA). For numeric styles like IEEE, `author-only` often returns empty or
   * `[NO_PRINTED_FORM]`, so fall back to `author + suppress-author cite`
   * (e.g. `Karger [1]`).
   */
  citeNarrative(id: string): string {
    const item = this.items.get(id);
    if (!item) return id;
    const author = formatNarrativeAuthor(item);
    if (!this.engine) {
      const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
      return `${author} (${year})`;
    }

    // All calls use makeCitationCluster (stateless) to avoid mutating the
    // engine's citation registry.  The old processCitationCluster approach
    // registered a phantom citation that corrupted numbering.  See #498.

    // Try author-only first (works for author-date styles like APA).
    // Numeric styles (e.g. IEEE) may throw or return [NO_PRINTED_FORM].
    try {
      const authorOnly = this.engine.makeCitationCluster([
        { id, "author-only": true },
      ]).trim();

      if (authorOnly && !authorOnly.includes("[NO_PRINTED_FORM]")) {
        const yearPart = this.engine.makeCitationCluster([
          { id, "suppress-author": true },
        ]).trim();
        if (yearPart) {
          return `${authorOnly} ${yearPart}`;
        }
        return authorOnly;
      }
    } catch (_error) {
      // author-only not supported by this style — fall through to suppress-author
    }

    // Numeric style fallback: author name + suppress-author cite (e.g. "Karger [1]").
    try {
      const suppressed = this.engine.makeCitationCluster([
        { id, "suppress-author": true },
      ]).trim();
      if (suppressed) {
        return `${author} ${suppressed}`;
      }
    } catch (e: unknown) {
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

  get citationRegistrationKey(): string | null {
    return this.registeredCitationKey;
  }

  private async waitForLatestInit(initPromise: Promise<void> | null): Promise<void> {
    let pending = initPromise;
    while (pending) {
      await pending;
      if (pending === this.initPromise) return;
      pending = this.initPromise;
    }
  }

  private async initEngine(
    styleGeneration: number = this.styleGeneration,
    styleXml: string = this.styleXml,
  ): Promise<void> {
    const styleName = getStyleName(this.processorId, styleGeneration);

    try {
      const { plugins } = await loadCitationJs();
      if (styleGeneration !== this.styleGeneration) return;
      const cslConfig =
        plugins.config.get("@csl")
        ?? plugins.config.get("csl");
      if (!cslConfig?.templates?.add || !cslConfig.engine) {
        throw new Error("citation-js CSL config unavailable");
      }
      // citation-js caches engines by style name + locale and mutates the
      // shared engine's retrieveItem callback on reuse. Use a processor- and
      // style-generation-specific key so processors cannot overwrite each
      // other's item lookup state, and style changes always force a new engine.
      cslConfig.templates.add(styleName, styleXml);
      const data = [...this.items.values()];
      const engine = cslConfig.engine(data, styleName, "en-US", "html");
      if (styleGeneration === this.styleGeneration) {
        this.engine = engine;
        this.registeredCitationKey = null;
      }
    } catch (e: unknown) {
      // Invalid or unsupported CSL style XML -- disable engine, fall back to simple formatting
      console.warn("[csl] initEngine() failed, falling back to simple formatting", e);
      if (styleGeneration === this.styleGeneration) {
        this.engine = null;
        this.registeredCitationKey = null;
      }
    } finally {
      if (styleGeneration === this.styleGeneration) {
        this.engineRevision += 1;
      }
    }
  }
}

/** Shape of a reference with parallel id/locator arrays (matches ReferenceSemantics). */
interface RefWithIds {
  readonly from: number;
  readonly to: number;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

/** Minimal interface for a store that can check whether a citation id exists. */
interface IdLookup {
  has(id: string): boolean;
}

interface CitationCollectionOptions {
  readonly isLocalTarget?: (id: string) => boolean;
}

function isCitationId(
  id: string,
  store: IdLookup,
  options?: CitationCollectionOptions,
): boolean {
  return store.has(id) && !options?.isLocalTarget?.(id);
}

/**
 * Filter references against a bibliography store, returning only the
 * citation-relevant ids and locators from each reference that has at least
 * one known bib entry.
 *
 * Used by both the CM6 editor (reference-render.ts) and preview renderer
 * preview renderers before CSL registration, and by the bibliography
 * plugin to collect cited ids.
 */
export function collectCitationMatches(
  references: readonly RefWithIds[],
  store: IdLookup,
  options?: CitationCollectionOptions,
): Array<{ ids: string[]; locators: (string | undefined)[] }> {
  return references
    .filter((ref) => ref.ids.some((id) => isCitationId(id, store, options)))
    .map((ref) => {
      const ids: string[] = [];
      const locators: Array<string | undefined> = [];
      ref.ids.forEach((id, index) => {
        if (!isCitationId(id, store, options)) return;
        ids.push(id);
        locators.push(ref.locators[index]);
      });
      return { ids, locators };
    });
}

/**
 * Collect all unique cited ids from references in document order.
 *
 * Convenience wrapper over `collectCitationMatches` for callers that
 * only need a flat deduplicated id list (e.g. the bibliography plugin).
 *
 * @deprecated Prefer `collectCitedIdsFromReferenceIndex()` when document
 * analysis is already available.
 */
export function collectCitedIdsFromReferences(
  references: readonly RefWithIds[],
  store: IdLookup,
): string[] {
  const seen = new Set<string>();
  const citedIds: string[] = [];
  for (const match of collectCitationMatches(references, store)) {
    for (const id of match.ids) {
      if (!seen.has(id)) {
        seen.add(id);
        citedIds.push(id);
      }
    }
  }
  return citedIds;
}

export function collectCitedIdsFromReferenceIndex(
  referenceIndex: ReferenceIndexModel,
  store: IdLookup,
): string[] {
  const citedIds: string[] = [];
  for (const entry of referenceIndex.values()) {
    if (entry.type !== "citation" || !store.has(entry.id)) continue;
    citedIds.push(entry.id);
  }
  return citedIds;
}

export interface CitationBacklink {
  readonly occurrence: number;
  readonly from: number;
  readonly to: number;
}

export interface CitationBacklinkIndex {
  readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>;
}

/**
 * Collect bibliography backlink targets in citation order.
 *
 * Each citation cluster that contains at least one known bibliography id gets a
 * sequential occurrence number. Every cited id in that cluster receives a
 * backlink to the same source range.
 */
export function collectCitationBacklinksFromReferences(
  references: readonly RefWithIds[],
  store: IdLookup,
): ReadonlyMap<string, readonly CitationBacklink[]> {
  return collectCitationBacklinkIndexFromReferences(references, store).backlinks;
}

export function collectCitationBacklinkIndexFromReferences(
  references: readonly RefWithIds[],
  store: IdLookup,
  options?: CitationCollectionOptions,
): CitationBacklinkIndex {
  const backlinks = new Map<string, CitationBacklink[]>();
  let occurrence = 0;

  for (const ref of references) {
    const ids = ref.ids.filter((id, index, arr) =>
      isCitationId(id, store, options) && arr.indexOf(id) === index);
    if (ids.length === 0) continue;

    occurrence += 1;
    const backlink: CitationBacklink = {
      occurrence,
      from: ref.from,
      to: ref.to,
    };

    for (const id of ids) {
      const entries = backlinks.get(id);
      if (entries) {
        entries.push(backlink);
      } else {
        backlinks.set(id, [backlink]);
      }
    }
  }

  return { backlinks };
}

/**
 * Register citation matches with a CSL processor in document order.
 *
 * Both the CM6 editor (citation-render.ts) and preview renderers need this
 * step so numeric styles assign numbers
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
