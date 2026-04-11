import { useEffect, useMemo, useState } from "react";

import { extractDocumentLabelReferences } from "../../app/markdown/labels";
import { buildCitationBacklinkMap } from "../../citations/bibliography";
import { type BibStore, type CslJsonItem, parseBibTeX } from "../../citations/bibtex-parser";
import {
  collectCitationBacklinksFromReferences,
  collectCitationClusters,
  collectCitedIdsFromClusters,
} from "../../citations/markdown-citations";
import { CslProcessor, getCitationRegistrationKey, type CitationBacklink } from "../../citations/csl-processor";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import type { LexicalRenderResourceResolver } from "./resource-resolver";

export interface CitationRenderData {
  readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>;
  readonly citedIds: readonly string[];
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
}

export interface LoadedBibliography {
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
}

const EMPTY_STORE: BibStore = new Map<string, CslJsonItem>();

export const EMPTY_BIBLIOGRAPHY: LoadedBibliography = {
  store: EMPTY_STORE,
};

export const EMPTY_CITATIONS: CitationRenderData = {
  backlinks: new Map(),
  citedIds: [],
  store: EMPTY_STORE,
};

export async function loadBibliographyResource(
  config: FrontmatterConfig,
  resolver: Pick<LexicalRenderResourceResolver, "readProjectTextFile">,
): Promise<LoadedBibliography> {
  const bibliographyPath = config.bibliography?.trim();
  if (!bibliographyPath) {
    return EMPTY_BIBLIOGRAPHY;
  }

  const bibText = await resolver.readProjectTextFile(bibliographyPath);
  if (!bibText) {
    return EMPTY_BIBLIOGRAPHY;
  }

  const items = parseBibTeX(bibText);
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
  if (loadedBibliography.store.size === 0) {
    return EMPTY_CITATIONS;
  }

  const references = extractDocumentLabelReferences(doc);
  const clusters = collectCitationClusters(references, loadedBibliography.store);
  const cslProcessor = loadedBibliography.cslProcessor;
  if (
    cslProcessor
    && cslProcessor.citationRegistrationKey !== getCitationRegistrationKey(clusters)
  ) {
    cslProcessor.registerCitations(clusters);
  }

  return {
    backlinks: buildCitationBacklinkMap(
      collectCitationBacklinksFromReferences(references, loadedBibliography.store),
    ),
    citedIds: collectCitedIdsFromClusters(clusters),
    cslProcessor,
    store: loadedBibliography.store,
  };
}

export function useCitationRenderData(
  doc: string,
  config: FrontmatterConfig,
  resolver: Pick<LexicalRenderResourceResolver, "readProjectTextFile">,
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
