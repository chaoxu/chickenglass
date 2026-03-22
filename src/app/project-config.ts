/**
 * Project configuration system.
 *
 * A project is a folder (typically a git repo) with a `coflat.yaml`
 * config file at the root. The config provides default settings inherited
 * by all documents in the project. Per-file frontmatter overrides these.
 *
 * ProjectConfig is derived from FrontmatterConfig (minus `title`, which is
 * always per-file). A CM6 Facet makes the config available to the frontmatter
 * StateField for merging.
 */

import { Facet } from "@codemirror/state";

import type { FrontmatterConfig } from "../parser/frontmatter";
import { parseFrontmatter } from "../parser/frontmatter";
import type { FileSystem } from "./file-manager";

/** Project-level configuration. Derived from FrontmatterConfig, minus title (always per-file). */
export type ProjectConfig = Omit<FrontmatterConfig, "title">;

/** Well-known project config file name. */
export const PROJECT_CONFIG_FILE = "coflat.yaml";

/**
 * CM6 Facet that holds the project-level configuration.
 *
 * Extensions provide a ProjectConfig value; the frontmatter StateField
 * reads the combined value and merges it with per-file frontmatter.
 */
export const projectConfigFacet = Facet.define<ProjectConfig, ProjectConfig>({
  combine(values) {
    // There should be at most one provider. Take the last one.
    return values.length > 0 ? values[values.length - 1] : {};
  },
});

/**
 * Parse a `coflat.yaml` file into a ProjectConfig.
 *
 * The config file uses the same YAML subset as frontmatter (without the
 * `---` delimiters). We wrap the content in `---` delimiters and reuse
 * the frontmatter parser.
 */
export function parseProjectConfig(yaml: string): ProjectConfig {
  // Wrap in frontmatter delimiters so we can reuse the existing parser
  const wrapped = `---\n${yaml}\n---\n`;
  const { config } = parseFrontmatter(wrapped);

  // ProjectConfig excludes title (title is always per-file)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { title, ...projectConfig } = config;
  return projectConfig;
}

/** Keys whose values are Record objects and merge additively (project base, file overrides). */
const ADDITIVE_KEYS: ReadonlySet<keyof FrontmatterConfig> = new Set(["math", "blocks"]);

/**
 * Merge project-level config with per-file frontmatter config.
 *
 * Merge rules:
 * - `title`: file only (project config has no title)
 * - Additive keys (`math`, `blocks`): spread-merge (project base, file overrides)
 * - All other keys: file overrides project
 */
export function mergeConfigs(
  project: ProjectConfig,
  file: FrontmatterConfig,
): FrontmatterConfig {
  const merged: FrontmatterConfig = {};

  // title is always from the file (project has no title)
  if (file.title !== undefined) merged.title = file.title;

  const allKeys = new Set([
    ...Object.keys(project) as (keyof ProjectConfig)[],
    ...Object.keys(file).filter((k) => k !== "title") as (keyof ProjectConfig)[],
  ]);

  for (const key of allKeys) {
    if (ADDITIVE_KEYS.has(key)) {
      // Additive: spread-merge both sides
      const projVal = project[key] as Record<string, unknown> | undefined;
      const fileVal = file[key] as Record<string, unknown> | undefined;
      if (projVal || fileVal) {
        (merged as Record<string, unknown>)[key] = { ...projVal, ...fileVal };
      }
    } else {
      // Scalar: file overrides project
      const value = file[key] ?? project[key];
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return merged;
}

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
  } catch {
    // Config file missing, unreadable, or invalid YAML — use empty config
    return {};
  }
}
