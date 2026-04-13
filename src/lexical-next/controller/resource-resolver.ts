import { useEffect, useMemo, useState } from "react";

import { loadProjectConfig } from "../../app/project-config";
import type { ProjectConfig } from "../../project-config";
import type { FileSystem } from "../../app/file-manager";
import {
  createLexicalRenderResourceResolver,
  type LexicalRenderResourceResolver,
} from "./resource-resolver-core";

export {
  createLexicalRenderResourceResolver,
  type LexicalRenderResourceResolver,
} from "./resource-resolver-core";

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
