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
