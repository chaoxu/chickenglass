import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { buildDocumentLabelParseSnapshot } from "../lib/markdown/label-parser";
import { useFileSystem } from "../app/contexts/file-system-context";
import { useProjectConfigResource } from "../app/hooks/use-project-config-resource";
import type { FileSystem } from "../lib/types";
import { measureSync } from "../lib/perf";
import { type CitationRenderData, useCitationRenderData } from "../citations/citation-render-data";
import { buildDocumentRuntime, type LexicalDocumentRuntime } from "./runtime/controller/document-runtime";
import {
  useLexicalRenderResourceResolver,
} from "./runtime/controller/resource-resolver";

/**
 * Two contexts to cut per-keystroke fan-out (issue #172):
 *
 * - LexicalRenderResourceContext — stable resources (fs, docPath, resolver,
 *   resolveAssetUrl). Changes only when docPath or the fs identity changes,
 *   which is rare. Hooks that only need to load/resolve assets subscribe to
 *   this and do not re-render on every keystroke.
 *
 * - LexicalRenderContext — document-derived runtime (doc, citations, config,
 *   renderIndex, labelGraph, footnoteDefinitions). Changes on every doc edit.
 *   Renderers that format text based on the doc subscribe here.
 *
 * Consumers that need both read both; React 18 batches the resulting renders.
 */

export interface LexicalRenderResources {
  readonly docPath?: string;
  readonly fs: FileSystem;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

export interface LexicalRenderContextValue extends LexicalDocumentRuntime {
  readonly citations: CitationRenderData;
  readonly doc: string;
  readonly docPath?: string;
  readonly fs: FileSystem;
}

const LexicalRenderResourceContext = createContext<LexicalRenderResources | null>(null);
const LexicalRenderContext = createContext<LexicalRenderContextValue | null>(null);

interface LexicalRenderContextProviderProps {
  readonly children: ReactNode;
  readonly doc: string;
  readonly docPath?: string;
  readonly value?: LexicalRenderContextValue;
}

export function LexicalRenderContextProvider({
  children,
  doc,
  docPath,
  value,
}: LexicalRenderContextProviderProps) {
  if (value) {
    const resources: LexicalRenderResources = {
      docPath: value.docPath,
      fs: value.fs,
      resolveAssetUrl: value.resolveAssetUrl,
    };
    return (
      <LexicalRenderResourceContext.Provider value={resources}>
        <LexicalRenderContext.Provider value={value}>
          {children}
        </LexicalRenderContext.Provider>
      </LexicalRenderResourceContext.Provider>
    );
  }

  return (
    <LexicalRenderContextRuntimeProvider doc={doc} docPath={docPath}>
      {children}
    </LexicalRenderContextRuntimeProvider>
  );
}

function LexicalRenderContextRuntimeProvider({
  children,
  doc,
  docPath,
}: Omit<LexicalRenderContextProviderProps, "value">) {
  const fs = useFileSystem();
  const resolver = useLexicalRenderResourceResolver(fs, docPath);
  const projectConfig = useProjectConfigResource(fs);
  const documentSnapshot = useMemo(() => buildDocumentLabelParseSnapshot(doc), [doc]);
  const documentRuntime = useMemo(
    () => measureSync(
      "lexical.buildDocumentRuntime",
      () => buildDocumentRuntime(doc, projectConfig, resolver, documentSnapshot),
      { category: "lexical", detail: `${doc.length} chars` },
    ),
    [doc, documentSnapshot, projectConfig, resolver],
  );
  const citations = useCitationRenderData(documentSnapshot, documentRuntime.config, resolver);

  const resources = useMemo<LexicalRenderResources>(() => ({
    docPath,
    fs,
    resolveAssetUrl: documentRuntime.resolveAssetUrl,
  }), [docPath, fs, documentRuntime.resolveAssetUrl]);

  const computedValue = useMemo<LexicalRenderContextValue>(() => ({
    citations,
    doc,
    docPath,
    ...documentRuntime,
    fs,
  }), [citations, doc, docPath, documentRuntime, fs]);

  return (
    <LexicalRenderResourceContext.Provider value={resources}>
      <LexicalRenderContext.Provider value={computedValue}>
        {children}
      </LexicalRenderContext.Provider>
    </LexicalRenderResourceContext.Provider>
  );
}

export function useLexicalRenderContext(): LexicalRenderContextValue {
  const value = useContext(LexicalRenderContext);
  if (!value) {
    throw new Error("useLexicalRenderContext must be used within a LexicalRenderContextProvider");
  }
  return value;
}

export function useLexicalRenderResources(): LexicalRenderResources {
  const value = useContext(LexicalRenderResourceContext);
  if (!value) {
    throw new Error("useLexicalRenderResources must be used within a LexicalRenderContextProvider");
  }
  return value;
}
