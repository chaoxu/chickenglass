import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useFileSystem } from "../app/contexts/file-system-context";
import type { FileSystem } from "../app/file-manager";
import { buildDocumentLabelGraph, extractDocumentLabelReferences, type DocumentLabelGraph } from "../app/markdown/labels";
import { type BibStore, parseBibTeX } from "../citations/bibtex-parser";
import { buildCitationBacklinkMap } from "../citations/bibliography";
import { collectCitationBacklinksFromReferences, collectCitationClusters, collectCitedIdsFromClusters } from "../citations/markdown-citations";
import { CslProcessor, getCitationRegistrationKey, type CitationBacklink } from "../citations/csl-processor";
import { parseFrontmatter, type FrontmatterConfig } from "../lib/frontmatter";
import { normalizeProjectPath, projectPathCandidatesFromDocument } from "../lib/project-paths";
import { PROJECT_CONFIG_FILE, mergeConfigs, parseProjectConfig, type ProjectConfig } from "../project-config";
import { buildFootnoteDefinitionMap, buildRenderIndex, buildStaticAssetUrl, type RenderIndex } from "./rendering";

export interface CitationRenderData {
  readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>;
  readonly citedIds: readonly string[];
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
}

interface LoadedBibliography {
  readonly cslProcessor?: CslProcessor;
  readonly store: Map<string, import("../citations/bibtex-parser").CslJsonItem>;
}

export interface LexicalRenderContextValue {
  readonly citations: CitationRenderData;
  readonly config: FrontmatterConfig;
  readonly doc: string;
  readonly docPath?: string;
  readonly footnoteDefinitions: ReadonlyMap<string, string>;
  readonly fs: FileSystem;
  readonly labelGraph: DocumentLabelGraph;
  readonly renderIndex: RenderIndex;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

const LexicalRenderContext = createContext<LexicalRenderContextValue | null>(null);

interface LexicalRenderContextProviderProps {
  readonly children: ReactNode;
  readonly doc: string;
  readonly docPath?: string;
  readonly value?: LexicalRenderContextValue;
}

const EMPTY_BIBLIOGRAPHY: LoadedBibliography = {
  store: new Map(),
};

const EMPTY_CITATIONS: CitationRenderData = {
  backlinks: new Map(),
  citedIds: [],
  store: new Map(),
};

async function readProjectTextFile(
  fs: FileSystem,
  docPath: string | undefined,
  targetPath: string,
): Promise<string | null> {
  const candidates = docPath
    ? projectPathCandidatesFromDocument(docPath, targetPath)
    : [normalizeProjectPath(targetPath)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function LexicalRenderContextProvider({
  children,
  doc,
  docPath,
  value,
}: LexicalRenderContextProviderProps) {
  const fs = useFileSystem();
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});
  const [loadedBibliography, setLoadedBibliography] = useState<LoadedBibliography>(EMPTY_BIBLIOGRAPHY);

  useEffect(() => {
    let cancelled = false;

    void fs.readFile(PROJECT_CONFIG_FILE)
      .then((yaml) => {
        if (!cancelled) {
          setProjectConfig(parseProjectConfig(yaml));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectConfig({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fs]);

  const frontmatter = useMemo(() => parseFrontmatter(doc), [doc]);
  const config = useMemo(
    () => mergeConfigs(projectConfig, frontmatter.config),
    [frontmatter.config, projectConfig],
  );
  const renderIndex = useMemo(() => buildRenderIndex(doc, config), [config, doc]);
  const footnoteDefinitions = useMemo(() => buildFootnoteDefinitionMap(doc), [doc]);
  const labelGraph = useMemo(() => buildDocumentLabelGraph(doc), [doc]);

  useEffect(() => {
    let cancelled = false;
    const bibliographyPath = config.bibliography?.trim();
    const cslPath = config.csl?.trim();

    if (!bibliographyPath) {
      setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const bibText = await readProjectTextFile(fs, docPath, bibliographyPath);
      if (!bibText) {
        if (!cancelled) {
          setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
        }
        return;
      }

      const items = parseBibTeX(bibText);
      const store = new Map(items.map((item) => [item.id, item]));
      let cslXml: string | undefined;
      if (cslPath) {
        cslXml = await readProjectTextFile(fs, docPath, cslPath) ?? undefined;
      }
      const cslProcessor = items.length > 0
        ? await CslProcessor.create(items, cslXml)
        : undefined;

      if (!cancelled) {
        setLoadedBibliography({
          cslProcessor,
          store,
        });
      }
    })().catch((error) => {
      console.warn("[bibliography] failed to load bibliography", error);
      if (!cancelled) {
        setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [config.bibliography, config.csl, docPath, fs]);

  const citations = useMemo<CitationRenderData>(() => {
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
  }, [doc, loadedBibliography]);

  const computedValue = useMemo<LexicalRenderContextValue>(() => ({
    citations,
    config,
    doc,
    docPath,
    fs,
    footnoteDefinitions,
    labelGraph,
    renderIndex,
    resolveAssetUrl: (targetPath: string) => buildStaticAssetUrl(docPath, targetPath),
  }), [citations, config, doc, docPath, footnoteDefinitions, fs, labelGraph, renderIndex]);

  return (
    <LexicalRenderContext.Provider value={value ?? computedValue}>
      {children}
    </LexicalRenderContext.Provider>
  );
}

export function useLexicalRenderContext(): LexicalRenderContextValue {
  const value = useContext(LexicalRenderContext);
  if (!value) {
    throw new Error("useLexicalRenderContext must be used within a LexicalRenderContextProvider");
  }
  return value;
}

export function useIncludedDocument(path: string | undefined): string | null {
  const { docPath, fs } = useLexicalRenderContext();
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!path || !docPath) {
      setContent(null);
      return () => {
        cancelled = true;
      };
    }

    const candidates = projectPathCandidatesFromDocument(docPath, path);
    setContent(null);

    void (async () => {
      for (const candidate of candidates) {
        try {
          const next = await fs.readFile(candidate);
          if (!cancelled) {
            setContent(next);
          }
          return;
        } catch {
          // Try the next candidate.
        }
      }
      if (!cancelled) {
        setContent(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docPath, fs, path]);

  return content;
}
