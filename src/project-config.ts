import type { FrontmatterConfig } from "./lib/frontmatter";
import { parseFrontmatter } from "./lib/frontmatter";

/** Project-level configuration. Derived from FrontmatterConfig, minus title (always per-file). */
export type ProjectConfig = Omit<FrontmatterConfig, "title">;

/** Well-known project config file name. */
export const PROJECT_CONFIG_FILE = "coflat.yaml";

/**
 * Parse a `coflat.yaml` file into a ProjectConfig.
 *
 * The config file uses the same YAML subset as frontmatter (without the
 * `---` delimiters). We wrap the content in `---` delimiters and reuse
 * the frontmatter parser.
 */
export function parseProjectConfig(yaml: string): ProjectConfig {
  const wrapped = `---\n${yaml}\n---\n`;
  const { config } = parseFrontmatter(wrapped);

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

  if (file.title !== undefined) merged.title = file.title;

  const allKeys = new Set([
    ...Object.keys(project) as (keyof ProjectConfig)[],
    ...Object.keys(file).filter((key) => key !== "title") as (keyof ProjectConfig)[],
  ]);

  for (const key of allKeys) {
    if (ADDITIVE_KEYS.has(key)) {
      const projectValue = project[key] as Record<string, unknown> | undefined;
      const fileValue = file[key] as Record<string, unknown> | undefined;
      if (projectValue || fileValue) {
        (merged as Record<string, unknown>)[key] = { ...projectValue, ...fileValue };
      }
      continue;
    }

    const value = file[key] ?? project[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}
