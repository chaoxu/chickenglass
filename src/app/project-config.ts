/**
 * Project configuration system.
 *
 * A project is a folder (typically a git repo) with a `coflat.yaml`
 * config file at the root. The config provides default settings inherited
 * by all documents in the project. Per-file frontmatter overrides these.
 *
 * The CM6 Facet and pure utilities live in `src/editor/project-config.ts`.
 * This module keeps the app-layer `loadProjectConfig` function that requires
 * the FileSystem abstraction, and re-exports everything else for backward
 * compatibility.
 */

// Re-export CM6 facet and pure utilities from the canonical location.
export {
  type ProjectConfig,
  PROJECT_CONFIG_FILE,
  projectConfigFacet,
  parseProjectConfig,
  mergeConfigs,
} from "../project-config";

import type { ProjectConfig } from "../project-config";
import { PROJECT_CONFIG_FILE, parseProjectConfig } from "../project-config";
import type { FileSystem } from "./file-manager";

/**
 * Try to load a project config from the filesystem root.
 *
 * Returns an empty config if the file doesn't exist or can't be parsed.
 */
export async function loadProjectConfig(
  fs: FileSystem,
): Promise<ProjectConfig> {
  try {
    const exists = await fs.exists(PROJECT_CONFIG_FILE);
    if (!exists) return {};

    const content = await fs.readFile(PROJECT_CONFIG_FILE);
    return parseProjectConfig(content);
  } catch (e: unknown) {
    // Config file missing, unreadable, or invalid YAML — use empty config
    console.warn("[project-config] failed to load config, using defaults", e);
    return {};
  }
}
