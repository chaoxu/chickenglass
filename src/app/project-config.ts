/**
 * Project configuration system.
 *
 * A project is a folder (typically a git repo) with a `chickenglass.yaml`
 * config file at the root. The config provides default settings inherited
 * by all documents in the project. Per-file frontmatter overrides these.
 *
 * The project config uses the same shape as FrontmatterConfig (minus `title`,
 * which is always per-file). A CM6 Facet makes the config available to
 * the frontmatter StateField for merging.
 */

import { Facet } from "@codemirror/state";

import type { BlockConfig, FrontmatterConfig } from "../parser/frontmatter";
import { parseFrontmatter } from "../parser/frontmatter";
import type { FileSystem } from "./file-manager";

/** Project-level configuration. Same shape as FrontmatterConfig but without title. */
export interface ProjectConfig {
  bibliography?: string;
  csl?: string;
  blocks?: Record<string, boolean | BlockConfig>;
  math?: Record<string, string>;
  /** Default image folder for all documents in the project. */
  imageFolder?: string;
}

/** Well-known project config file name. */
export const PROJECT_CONFIG_FILE = "chickenglass.yaml";

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
 * Parse a `chickenglass.yaml` file into a ProjectConfig.
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
  const result: ProjectConfig = {};
  if (config.bibliography) result.bibliography = config.bibliography;
  if (config.csl) result.csl = config.csl;
  if (config.blocks) result.blocks = config.blocks;
  if (config.math) result.math = config.math;
  if (config.imageFolder) result.imageFolder = config.imageFolder;
  return result;
}

/**
 * Merge project-level config with per-file frontmatter config.
 *
 * Merge rules:
 * - `title`: file only (project config has no title)
 * - `bibliography`: file overrides project
 * - `csl`: file overrides project
 * - `math`: merged additively — file macros add to and override project macros
 * - `blocks`: merged additively — file entries add to and override project entries
 */
export function mergeConfigs(
  project: ProjectConfig,
  file: FrontmatterConfig,
): FrontmatterConfig {
  const merged: FrontmatterConfig = {};

  // title is always from the file
  if (file.title !== undefined) merged.title = file.title;

  // bibliography / csl: file overrides project
  const bib = file.bibliography ?? project.bibliography;
  if (bib !== undefined) merged.bibliography = bib;

  const csl = file.csl ?? project.csl;
  if (csl !== undefined) merged.csl = csl;

  // math: additive merge (project base, file overrides)
  if (project.math || file.math) {
    merged.math = { ...project.math, ...file.math };
  }

  // blocks: additive merge (project base, file overrides)
  if (project.blocks || file.blocks) {
    merged.blocks = { ...project.blocks, ...file.blocks };
  }

  // imageFolder: file overrides project
  const imgFolder = file.imageFolder ?? project.imageFolder;
  if (imgFolder !== undefined) merged.imageFolder = imgFolder;

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
