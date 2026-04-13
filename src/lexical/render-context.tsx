import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { buildDocumentLabelParseSnapshot } from "../app/markdown/label-parser";
import { useFileSystem } from "../app/contexts/file-system-context";
import type { FileSystem } from "../app/file-manager";
import { type CitationRenderData, useCitationRenderData } from "../lexical-next/controller/citation-runtime";
import { buildDocumentRuntime, type LexicalDocumentRuntime } from "../lexical-next/controller/document-runtime";
import {
  useIncludedDocumentResource,
  useLexicalRenderResourceResolver,
  useProjectConfigResource,
} from "../lexical-next/controller/resource-resolver";

export interface LexicalRenderContextValue extends LexicalDocumentRuntime {
  readonly citations: CitationRenderData;
  readonly doc: string;
  readonly docPath?: string;
  readonly fs: FileSystem;
}

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
    return (
      <LexicalRenderContext.Provider value={value}>
        {children}
      </LexicalRenderContext.Provider>
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
  const projectConfig = useProjectConfigResource(resolver);
  const documentSnapshot = useMemo(() => buildDocumentLabelParseSnapshot(doc), [doc]);
  const documentRuntime = useMemo(
    () => buildDocumentRuntime(doc, projectConfig, resolver, documentSnapshot),
    [doc, documentSnapshot, projectConfig, resolver],
  );
  const citations = useCitationRenderData(documentSnapshot.references, documentRuntime.config, resolver);

  const computedValue = useMemo<LexicalRenderContextValue>(() => ({
    citations,
    doc,
    docPath,
    ...documentRuntime,
    fs,
  }), [citations, doc, docPath, documentRuntime, fs]);

  return (
    <LexicalRenderContext.Provider value={computedValue}>
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
  const resolver = useLexicalRenderResourceResolver(fs, docPath);
  return useIncludedDocumentResource(path, resolver);
}
