/**
 * Canonical project configuration utilities shared across editor/app/state.
 *
 * Keeps the CM6 Facet and pure merge/parse helpers in a neutral owner so
 * other subsystems do not need to import them through editor/.
 */

import { Facet } from "@codemirror/state";
import type { FileSystem } from "./lib/types";
import type { FrontmatterConfig } from "./parser/frontmatter";
import { parseFrontmatter } from "./parser/frontmatter";

/** Project-level configuration. Derived from FrontmatterConfig, minus title (always per-file). */
export type ProjectConfig = Omit<FrontmatterConfig, "title">;

/** Well-known project config file name. */
export const PROJECT_CONFIG_FILE = "coflat.yaml";

export type ProjectConfigFailureKind = "read" | "parse";

export type ProjectConfigStatus =
  | { readonly state: "missing"; readonly path: string }
  | { readonly state: "ok"; readonly path: string }
  | {
    readonly state: "error";
    readonly path: string;
    readonly kind: ProjectConfigFailureKind;
    readonly message: string;
  };

export interface ProjectConfigLoadResult {
  readonly config: ProjectConfig;
  readonly status: ProjectConfigStatus;
}

const missingProjectConfigStatus: ProjectConfigStatus = {
  state: "missing",
  path: PROJECT_CONFIG_FILE,
};

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

export const projectConfigStatusFacet = Facet.define<ProjectConfigStatus, ProjectConfigStatus>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : missingProjectConfigStatus;
  },
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Parse a `coflat.yaml` file into a ProjectConfig.
 *
 * The config file uses the same YAML subset as frontmatter (without the
 * `---` delimiters). We wrap the content in `---` delimiters and reuse
 * the frontmatter parser.
 */
export function parseProjectConfig(yaml: string): ProjectConfig {
  return parseProjectConfigWithStatus(yaml).config;
}

export function parseProjectConfigWithStatus(yaml: string): ProjectConfigLoadResult {
  const wrapped = `---\n${yaml}\n---\n`;
  const { config, status } = parseFrontmatter(wrapped);

  // ProjectConfig excludes title (title is always per-file)
  const { title: _title, ...projectConfig } = config;
  if (status.state === "error") {
    return {
      config: {},
      status: {
        state: "error",
        path: PROJECT_CONFIG_FILE,
        kind: "parse",
        message: status.message,
      },
    };
  }
  return {
    config: projectConfig,
    status: { state: "ok", path: PROJECT_CONFIG_FILE },
  };
}

/**
 * Try to load a project config from the filesystem root.
 *
 * Returns an empty config if the file doesn't exist or can't be parsed.
 */
export async function loadProjectConfig(
  fs: FileSystem,
): Promise<ProjectConfig> {
  return (await loadProjectConfigWithStatus(fs)).config;
}

export async function loadProjectConfigWithStatus(
  fs: FileSystem,
): Promise<ProjectConfigLoadResult> {
  try {
    const exists = await fs.exists(PROJECT_CONFIG_FILE);
    if (!exists) {
      return { config: {}, status: missingProjectConfigStatus };
    }

    const content = await fs.readFile(PROJECT_CONFIG_FILE);
    return parseProjectConfigWithStatus(content);
  } catch (e: unknown) {
    // Config file checks/read failures use empty config and surface status.
    console.warn("[project-config] failed to load config, using defaults", e);
    return {
      config: {},
      status: {
        state: "error",
        path: PROJECT_CONFIG_FILE,
        kind: "read",
        message: errorMessage(e, "Unable to read project config"),
      },
    };
  }
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
