import { useEffect, useMemo, useState } from "react";

import type { FileSystem } from "../../app/file-manager";
import { loadProjectConfig } from "../../app/project-config";
import { normalizeProjectPath, projectPathCandidatesFromDocument } from "../../lib/project-paths";
import type { ProjectConfig } from "../../project-config";
import { buildStaticAssetUrl } from "../../lexical/markdown/asset-resolution";

export interface LexicalRenderResourceResolver {
  readonly docPath?: string;
  readonly fs: FileSystem;
  readonly readIncludedDocument: (targetPath: string) => Promise<string | null>;
  readonly readProjectTextFile: (targetPath: string) => Promise<string | null>;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

interface CandidateOptions {
  readonly requireDocumentPath?: boolean;
}

function getProjectPathCandidates(
  docPath: string | undefined,
  targetPath: string,
  options?: CandidateOptions,
): readonly string[] {
  const normalizedTarget = targetPath.trim();
  if (normalizedTarget.length === 0) {
    return [];
  }

  if (docPath) {
    return projectPathCandidatesFromDocument(docPath, normalizedTarget);
  }

  if (options?.requireDocumentPath) {
    return [];
  }

  const normalized = normalizeProjectPath(normalizedTarget);
  return normalized ? [normalized] : [];
}

async function readFirstAvailableTextFile(
  fs: FileSystem,
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function createLexicalRenderResourceResolver(
  fs: FileSystem,
  docPath?: string,
): LexicalRenderResourceResolver {
  return {
    docPath,
    fs,
    readIncludedDocument: (targetPath: string) =>
      readFirstAvailableTextFile(fs, getProjectPathCandidates(docPath, targetPath, {
        requireDocumentPath: true,
      })),
    readProjectTextFile: (targetPath: string) =>
      readFirstAvailableTextFile(fs, getProjectPathCandidates(docPath, targetPath)),
    resolveAssetUrl: (targetPath: string) => buildStaticAssetUrl(docPath, targetPath),
  };
}

export function useLexicalRenderResourceResolver(
  fs: FileSystem,
  docPath?: string,
): LexicalRenderResourceResolver {
  return useMemo(() => createLexicalRenderResourceResolver(fs, docPath), [docPath, fs]);
}

export function useProjectConfigResource(
  resolver: Pick<LexicalRenderResourceResolver, "fs">,
): ProjectConfig {
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});

  useEffect(() => {
    let cancelled = false;

    void loadProjectConfig(resolver.fs).then((nextConfig) => {
      if (!cancelled) {
        setProjectConfig(nextConfig);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [resolver.fs]);

  return projectConfig;
}

export function useIncludedDocumentResource(
  path: string | undefined,
  resolver: Pick<LexicalRenderResourceResolver, "readIncludedDocument">,
): string | null {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!path?.trim()) {
      setContent(null);
      return () => {
        cancelled = true;
      };
    }

    setContent(null);

    void resolver.readIncludedDocument(path).then((nextContent) => {
      if (!cancelled) {
        setContent(nextContent);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [path, resolver.readIncludedDocument]);

  return content;
}
