import type { CslJsonItem } from "./bibtex-parser";
import defaultCslStyle from "./ieee.csl?raw";

interface CitationJsModules {
  plugins: typeof import("@citation-js/core").plugins;
}

let citationJsPromise: Promise<CitationJsModules> | null = null;

function loadCitationJs(): Promise<CitationJsModules> {
  if (!citationJsPromise) {
    citationJsPromise = (async () => {
      const [core] = await Promise.all([
        import("@citation-js/core"),
        import("@citation-js/plugin-csl"),
      ]);
      return { plugins: core.plugins };
    })();
  }
  return citationJsPromise;
}

type CiteprocEngine = import("@citation-js/core").CiteprocEngine;

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

const SORTED_LOCATOR_KEYS = [...LOCATOR_TERMS.keys()].sort((left, right) => right.length - left.length);

function serializeKeyPart(value: string | undefined): string {
  return value ?? "";
}

export interface CitationCluster {
  readonly ids: readonly string[];
  readonly locators?: readonly (string | undefined)[];
}

export interface CitationBacklink {
  readonly occurrence: number;
  readonly from: number;
  readonly to: number;
}

export function parseLocator(raw: string): { locator: string; label?: string } {
  const text = raw.trim();

  for (const prefix of SORTED_LOCATOR_KEYS) {
    if (text.toLowerCase().startsWith(prefix)) {
      const remainder = text.slice(prefix.length).trim();
      if (remainder) {
        return { locator: remainder, label: LOCATOR_TERMS.get(prefix) };
      }
    }
  }

  return { locator: text };
}

function buildCitationItems(
  ids: readonly string[],
  locators?: readonly (string | undefined)[],
): Array<{ id: string; locator?: string; label?: string }> {
  return ids.map((id, index) => {
    const raw = locators?.[index];
    if (raw) {
      const parsed = parseLocator(raw);
      return {
        id,
        locator: parsed.locator,
        label: parsed.label,
      };
    }
    return { id };
  });
}

function clusterKey(cluster: CitationCluster): string {
  return cluster.ids
    .map((id, index) => `${id}\0${serializeKeyPart(cluster.locators?.[index])}`)
    .join("\u0001");
}

export function getCitationRegistrationKey(clusters: readonly CitationCluster[]): string {
  return clusters.map(clusterKey).join("\u0002");
}

let nextProcessorId = 0;

function getStyleName(processorId: number, styleGeneration: number): string {
  return `coflat-${processorId}-${styleGeneration}`;
}

function formatNarrativeAuthor(item: CslJsonItem): string {
  const authors = item.author ?? [];
  if (authors.length === 0) {
    return item.id;
  }
  return authors
    .map((author) => author.literal ?? author.family ?? author.given ?? item.id)
    .join(", ");
}

export class CslProcessor {
  private readonly items: Map<string, CslJsonItem>;
  private engine: CiteprocEngine | null = null;
  private styleXml: string;
  private engineRevision = 0;
  private registeredCitationKey: string | null = null;
  private renderedClusters = new Map<string, string>();
  private initPromise: Promise<void> | null = null;
  private readonly processorId = nextProcessorId++;
  private styleGeneration = 0;

  constructor(entries: CslJsonItem[], styleXml?: string) {
    this.items = new Map(entries.map((item) => [item.id, item]));
    this.styleXml = styleXml ?? defaultCslStyle;
    if (this.items.size > 0) {
      this.initPromise = this.initEngine();
    }
  }

  static empty(): CslProcessor {
    return new CslProcessor([]);
  }

  static async create(entries: CslJsonItem[], styleXml?: string): Promise<CslProcessor> {
    const processor = new CslProcessor(entries, styleXml);
    await processor.ensureReady();
    return processor;
  }

  async ensureReady(): Promise<void> {
    await this.waitForLatestInit(this.initPromise);
  }

  async setStyle(styleXml: string): Promise<void> {
    this.styleXml = styleXml;
    this.styleGeneration += 1;
    const generation = this.styleGeneration;
    const previousInit = this.initPromise ?? Promise.resolve();
    const initPromise = previousInit.catch(() => undefined).then(async () => {
      if (generation !== this.styleGeneration) {
        return;
      }
      await this.initEngine(generation, styleXml);
    });
    this.initPromise = initPromise;
    await this.waitForLatestInit(initPromise);
  }

  registerCitations(clusters: readonly CitationCluster[]): void {
    this.registeredCitationKey = null;
    this.renderedClusters.clear();
    if (!this.engine) {
      return;
    }

    const registrationKey = getCitationRegistrationKey(clusters);
    this.engine.updateItems([]);
    const allIds = new Set<string>();
    for (const cluster of clusters) {
      for (const id of cluster.ids) {
        allIds.add(id);
      }
    }
    this.engine.updateItems([...allIds]);

    const citationsPre: Array<[string, number]> = [];
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index];
      try {
        const result = this.engine.processCitationCluster({
          citationItems: buildCitationItems(cluster.ids, cluster.locators),
          properties: { noteIndex: 0 },
          citationID: `cite-${index}`,
        }, citationsPre, []);
        // result[1] is an array of [pos, html, citationID] triples for clusters
        // whose rendering changed as a side effect of this insertion (numeric
        // styles renumber forward citations). Cache them all by content key.
        const updates: Array<[number, string, string?]> = result?.[1] ?? [];
        for (const update of updates) {
          const updatedCluster = clusters[update[0]];
          if (updatedCluster) {
            this.renderedClusters.set(clusterKey(updatedCluster), String(update[1]));
          }
        }
        citationsPre.push([`cite-${index}`, index]);
      } catch (error) {
        console.warn(`[csl] cluster error for cite-${index}`, error);
      }
    }

    this.registeredCitationKey = registrationKey;
  }

  cite(ids: string[], locators?: (string | undefined)[]): string {
    if (!this.engine || ids.length === 0) {
      return "";
    }
    const cached = this.renderedClusters.get(clusterKey({ ids, locators }));
    if (cached !== undefined) {
      return cached;
    }
    // Unregistered cluster (e.g., a per-id sub-render in a mixed cluster).
    // previewCitationCluster reuses the engine's processed-cluster state
    // without mutating it; unlike makeCitationCluster, it works for numeric
    // styles that depend on the registry's per-item `seq` assignments.
    try {
      const html = this.engine.previewCitationCluster(
        {
          citationItems: buildCitationItems(ids, locators),
          properties: { noteIndex: 0 },
        },
        [],
        [],
        "html",
      );
      return typeof html === "string" ? html : `[${ids.join("; ")}]`;
    } catch (error) {
      console.warn("[csl] cite() engine error", error);
      return `[${ids.join("; ")}]`;
    }
  }

  citeNarrative(id: string): string {
    const item = this.items.get(id);
    if (!item) {
      return id;
    }

    const author = formatNarrativeAuthor(item);
    if (!this.engine) {
      const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
      return `${author} (${year})`;
    }

    try {
      const authorOnly = this.engine.makeCitationCluster([{ id, "author-only": true }]).trim();
      if (authorOnly && !authorOnly.includes("[NO_PRINTED_FORM]")) {
        const yearPart = this.engine.makeCitationCluster([{ id, "suppress-author": true }]).trim();
        return yearPart ? `${authorOnly} ${yearPart}` : authorOnly;
      }
    } catch {
      // Fall through to numeric-style fallback.
    }

    try {
      const suppressed = this.engine.makeCitationCluster([{ id, "suppress-author": true }]).trim();
      if (suppressed) {
        return `${author} ${suppressed}`;
      }
    } catch (error) {
      console.warn("[csl] citeNarrative() engine error", error);
    }

    const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
    return `${author} (${year})`;
  }

  bibliography(citedIds: string[]): string[] {
    if (!this.engine || citedIds.length === 0) {
      return [];
    }
    try {
      const validIds = citedIds.filter((id) => this.items.has(id));
      if (validIds.length === 0) {
        return [];
      }
      const [, entries] = this.engine.makeBibliography();
      return entries.map((entry) => entry.trim());
    } catch (error) {
      console.warn("[csl] bibliography() engine error", error);
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
      if (pending === this.initPromise) {
        return;
      }
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
      if (styleGeneration !== this.styleGeneration) {
        return;
      }

      const cslConfig = plugins.config.get("@csl") ?? plugins.config.get("csl");
      if (!cslConfig?.templates?.add || !cslConfig.engine) {
        throw new Error("citation-js CSL config unavailable");
      }

      cslConfig.templates.add(styleName, styleXml);
      const engine = cslConfig.engine([...this.items.values()], styleName, "en-US", "html");
      if (styleGeneration === this.styleGeneration) {
        this.engine = engine;
        this.registeredCitationKey = null;
      }
    } catch (error) {
      console.warn("[csl] initEngine() failed, falling back to simple formatting", error);
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
