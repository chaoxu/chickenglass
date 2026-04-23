import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FIXTURE_OPEN_TIMEOUT_MS = 10000;
export const DEFAULT_FIXTURE_SETTLE_MS = 200;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");
export const REPO_DEMO_ROOT = resolve(REPO_ROOT, "demo");
export const REPO_FIXTURE_ROOT = resolve(REPO_ROOT, "fixtures");
export const EXTERNAL_DEMO_ROOT = "/Users/chaoxu/playground/coflat/demo";
export const EXTERNAL_FIXTURE_ROOT = "/Users/chaoxu/playground/coflat/fixtures";
export const PUBLIC_SHOWCASE_FIXTURE = {
  displayPath: "demo/index.md",
  virtualPath: "index.md",
  candidates: [
    resolve(REPO_ROOT, "demo/index.md"),
    resolve(EXTERNAL_DEMO_ROOT, "index.md"),
  ],
};

const TEXT_FIXTURE_EXTENSIONS = new Set([
  ".bib",
  ".csl",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const fixtureProjectPayloadCache = new Map();

function defaultFixtureCandidates(path) {
  return [
    resolve(REPO_DEMO_ROOT, path),
    resolve(REPO_FIXTURE_ROOT, path),
    resolve(EXTERNAL_DEMO_ROOT, path),
    resolve(EXTERNAL_FIXTURE_ROOT, path),
  ];
}

function inferFixtureDisplayPath(virtualPath, resolvedPath) {
  if (!resolvedPath) return `fixture:${virtualPath}`;
  if (
    resolvedPath.startsWith(`${REPO_DEMO_ROOT}/`) ||
    resolvedPath.startsWith(`${EXTERNAL_DEMO_ROOT}/`)
  ) {
    return `demo/${virtualPath}`;
  }
  if (
    resolvedPath.startsWith(`${REPO_FIXTURE_ROOT}/`) ||
    resolvedPath.startsWith(`${EXTERNAL_FIXTURE_ROOT}/`)
  ) {
    return `fixtures/${virtualPath}`;
  }
  return `fixture:${virtualPath}`;
}

function fixtureRootForResolvedPath(resolvedPath) {
  if (resolvedPath.startsWith(`${REPO_DEMO_ROOT}/`)) return REPO_DEMO_ROOT;
  if (resolvedPath.startsWith(`${REPO_FIXTURE_ROOT}/`)) return REPO_FIXTURE_ROOT;
  if (resolvedPath.startsWith(`${EXTERNAL_DEMO_ROOT}/`)) return EXTERNAL_DEMO_ROOT;
  if (resolvedPath.startsWith(`${EXTERNAL_FIXTURE_ROOT}/`)) return EXTERNAL_FIXTURE_ROOT;
  return null;
}

function inferFixtureProjectPrefix(virtualPath) {
  const slashIndex = virtualPath.indexOf("/");
  return slashIndex >= 0 ? virtualPath.slice(0, slashIndex) : null;
}

export function buildFixtureProjectPayload(virtualPath, resolvedPath) {
  const root = fixtureRootForResolvedPath(resolvedPath);
  const projectPrefix = inferFixtureProjectPrefix(virtualPath);
  if (!root) {
    return null;
  }

  const projectRoot = projectPrefix ? resolve(root, projectPrefix) : root;
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    return null;
  }

  const cacheKey = `${projectRoot}:${projectPrefix ?? ""}`;
  const cached = fixtureProjectPayloadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  /** @type {Array<
   *   { path: string, kind: "text", content: string } |
   *   { path: string, kind: "binary", base64: string }
   * >} */
  const files = [];
  const fingerprintParts = [];

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const repoRelativePath = relative(root, absolutePath).replace(/\\/g, "/");
      const stat = statSync(absolutePath);
      fingerprintParts.push(`${repoRelativePath}:${stat.size}:${stat.mtimeMs}`);
      const extension = extname(entry.name).toLowerCase();
      if (TEXT_FIXTURE_EXTENSIONS.has(extension)) {
        files.push({
          path: repoRelativePath,
          kind: "text",
          content: readFileSync(absolutePath, "utf8"),
        });
        continue;
      }

      files.push({
        path: repoRelativePath,
        kind: "binary",
        base64: readFileSync(absolutePath).toString("base64"),
      });
    }
  };

  visit(projectRoot);
  const payload = {
    key: `${cacheKey}:${fingerprintParts.sort().join("|")}`,
    files,
  };
  fixtureProjectPayloadCache.set(cacheKey, payload);
  return payload;
}

function isMissingFixtureError(error) {
  return error instanceof Error && error.message.startsWith("Missing fixture for ");
}

/**
 * Resolve a browser regression fixture from the repo demo tree or the external
 * demo root used by the perf harness.
 *
 * @param {string | {
 *   virtualPath: string,
 *   displayPath?: string,
 *   candidates?: string[],
 *   content?: string,
 * }} fixture
 */
export function resolveFixtureDocument(fixture) {
  const normalized = typeof fixture === "string"
    ? {
        virtualPath: fixture,
      }
    : {
        ...fixture,
      };
  const explicitDisplayPath = typeof fixture === "string"
    ? undefined
    : fixture.displayPath;
  const fallbackDisplayPath = explicitDisplayPath ?? `fixture:${normalized.virtualPath}`;

  if (typeof normalized.content === "string") {
    return {
      ...normalized,
      displayPath: fallbackDisplayPath,
      resolvedPath: normalized.resolvedPath ?? null,
      content: normalized.content,
      candidates: normalized.candidates ?? defaultFixtureCandidates(normalized.virtualPath),
    };
  }

  const candidates = normalized.candidates ?? defaultFixtureCandidates(normalized.virtualPath);
  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(
      `Missing fixture for ${fallbackDisplayPath}. Tried: ${candidates.join(", ")}`,
    );
  }

  return {
    ...normalized,
    displayPath: explicitDisplayPath ?? inferFixtureDisplayPath(normalized.virtualPath, resolvedPath),
    resolvedPath,
    content: readFileSync(resolvedPath, "utf8"),
    candidates,
  };
}

export function hasFixtureDocument(fixture) {
  try {
    resolveFixtureDocument(fixture);
    return true;
  } catch (error) {
    if (isMissingFixtureError(error)) {
      return false;
    }
    throw error;
  }
}

export function resolveFixtureDocumentWithFallback(
  fixture,
  fallbackFixture = PUBLIC_SHOWCASE_FIXTURE,
) {
  try {
    return resolveFixtureDocument(fixture);
  } catch (error) {
    if (!isMissingFixtureError(error)) {
      throw error;
    }
    return resolveFixtureDocument(fallbackFixture);
  }
}
