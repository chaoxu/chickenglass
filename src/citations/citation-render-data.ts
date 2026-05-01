import { useEffect, useMemo, useState } from "react";

import { buildCitationBacklinkMap } from "./bibliography";
import type { BibStore, CslJsonItem } from "./csl-json";
import {
  collectCitationBacklinksFromAnalysis,
  collectCitationBacklinksFromTokens,
  collectCitationClusters,
  collectCitationMatchesFromAnalysis,
  collectCitedIdsFromClusters,
  createReferenceIndexLocalTargetLookup,
  getCitationRegistrationKey,
  type CitationBacklink,
  type CitationCollectionOptions,
  type CitationReferenceToken,
} from "./citation-matching";
import { CslProcessor } from "./csl-processor";
import type { FrontmatterConfig } from "../parser/frontmatter";
import type { DocumentAnalysis } from "../semantics/document";
import { analyzeMarkdownSemantics } from "../semantics/markdown-analysis";

export interface CitationTextResourceResolver {
  readonly readProjectTextFile: (path: string) => Promise<string | null>;
}

export interface CitationRenderData {
  readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>;
  readonly citedIds: readonly string[];
  readonly cslProcessor?: CslProcessor;
  readonly rawStore?: BibStore;
  readonly store: BibStore;
}

export interface LoadedBibliography {
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
}

const EMPTY_STORE: BibStore = new Map<string, CslJsonItem>();

async function parseBibTeXLazy(content: string): Promise<CslJsonItem[]> {
  const { parseBibTeX } = await import("./bibtex-parser");
  return parseBibTeX(content);
}

export const EMPTY_BIBLIOGRAPHY: LoadedBibliography = {
  store: EMPTY_STORE,
};

export const EMPTY_CITATIONS: CitationRenderData = {
  backlinks: new Map(),
  citedIds: [],
  rawStore: EMPTY_STORE,
  store: EMPTY_STORE,
};

function filterCitationStore(
  store: BibStore,
  options?: CitationCollectionOptions,
): BibStore {
  if (!options?.isLocalTarget) return store;
  const filtered = new Map<string, CslJsonItem>();
  for (const [id, item] of store) {
    if (!options.isLocalTarget(id)) {
      filtered.set(id, item);
    }
  }
  return filtered;
}

export async function loadBibliographyResource(
  config: FrontmatterConfig,
  resolver: CitationTextResourceResolver,
): Promise<LoadedBibliography> {
  const bibliographyPath = config.bibliography?.trim();
  if (!bibliographyPath) {
    return EMPTY_BIBLIOGRAPHY;
  }

  const bibText = await resolver.readProjectTextFile(bibliographyPath);
  if (!bibText) {
    return EMPTY_BIBLIOGRAPHY;
  }

  const items = await parseBibTeXLazy(bibText);
  const store: BibStore = new Map(items.map((item) => [item.id, item]));
  const cslPath = config.csl?.trim();
  const cslXml = cslPath
    ? await resolver.readProjectTextFile(cslPath) ?? undefined
    : undefined;

  return {
    cslProcessor: items.length > 0
      ? await CslProcessor.create(items, cslXml)
      : undefined,
    store,
  };
}

export function buildCitationRenderData(
  doc: string,
  loadedBibliography: LoadedBibliography,
): CitationRenderData {
  return buildCitationRenderDataFromAnalysis(
    analyzeMarkdownSemantics(doc),
    loadedBibliography,
  );
}

export function buildCitationRenderDataFromAnalysis(
  analysis: Pick<DocumentAnalysis, "references" | "referenceIndex">,
  loadedBibliography: LoadedBibliography,
): CitationRenderData {
  if (loadedBibliography.store.size === 0) {
    return EMPTY_CITATIONS;
  }

  const options = {
    isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
  };
  const citationStore = filterCitationStore(loadedBibliography.store, options);
  const clusters = collectCitationMatchesFromAnalysis(analysis, loadedBibliography.store);
  const cslProcessor = loadedBibliography.cslProcessor;
  if (
    cslProcessor
    && cslProcessor.citationRegistrationKey !== getCitationRegistrationKey(clusters)
  ) {
    cslProcessor.registerCitations(clusters);
  }

  return {
    backlinks: buildCitationBacklinkMap(
      collectCitationBacklinksFromAnalysis(
        analysis,
        loadedBibliography.store,
      ),
    ),
    citedIds: collectCitedIdsFromClusters(clusters),
    cslProcessor,
    rawStore: loadedBibliography.store,
    store: citationStore,
  };
}

export function buildCitationRenderDataFromReferences(
  references: readonly CitationReferenceToken[],
  loadedBibliography: LoadedBibliography,
  options?: CitationCollectionOptions,
): CitationRenderData {
  if (loadedBibliography.store.size === 0) {
    return EMPTY_CITATIONS;
  }

  const citationStore = filterCitationStore(loadedBibliography.store, options);
  const clusters = collectCitationClusters(references, loadedBibliography.store, options);
  const cslProcessor = loadedBibliography.cslProcessor;
  if (
    cslProcessor
    && cslProcessor.citationRegistrationKey !== getCitationRegistrationKey(clusters)
  ) {
    cslProcessor.registerCitations(clusters);
  }

  return {
    backlinks: buildCitationBacklinkMap(
      collectCitationBacklinksFromTokens(
        references,
        loadedBibliography.store,
        options,
      ),
    ),
    citedIds: collectCitedIdsFromClusters(clusters),
    cslProcessor,
    rawStore: loadedBibliography.store,
    store: citationStore,
  };
}

export function useCitationRenderData(
  doc: string,
  config: FrontmatterConfig,
  resolver: CitationTextResourceResolver,
): CitationRenderData {
  const [loadedBibliography, setLoadedBibliography] = useState<LoadedBibliography>(EMPTY_BIBLIOGRAPHY);

  useEffect(() => {
    let cancelled = false;
    const bibliographyPath = config.bibliography?.trim();

    if (!bibliographyPath) {
      setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
      return () => {
        cancelled = true;
      };
    }

    void loadBibliographyResource(config, resolver)
      .then((nextBibliography) => {
        if (!cancelled) {
          setLoadedBibliography(nextBibliography);
        }
      })
      .catch((error) => {
        console.warn("[bibliography] failed to load bibliography", error);
        if (!cancelled) {
          setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config.bibliography, config.csl, resolver.readProjectTextFile]);

  return useMemo(
    () => buildCitationRenderData(doc, loadedBibliography),
    [doc, loadedBibliography],
  );
}
