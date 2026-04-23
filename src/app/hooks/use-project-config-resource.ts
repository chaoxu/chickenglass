import { useEffect, useState } from "react";

import type { ProjectConfig } from "../../project-config";
import { loadProjectConfig } from "../project-config";
import type { FileSystem } from "../../lib/types";

export function useProjectConfigResource(fs: FileSystem): ProjectConfig {
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});

  useEffect(() => {
    let cancelled = false;

    void loadProjectConfig(fs).then((nextConfig) => {
      if (!cancelled) {
        setProjectConfig(nextConfig);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fs]);

  return projectConfig;
}
