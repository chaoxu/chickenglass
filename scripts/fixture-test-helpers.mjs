import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

export const DEFAULT_FIXTURE_OPEN_TIMEOUT_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.fixtureOpenTimeoutMs;
export const DEFAULT_FIXTURE_SETTLE_MS =
  DEFAULT_RUNTIME_BUDGET_PROFILE.postOpenSettleMs;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");
export const REPO_DEMO_ROOT = resolve(REPO_ROOT, "demo");
export const REPO_FIXTURE_ROOT = resolve(REPO_ROOT, "fixtures");
export const EXTERNAL_DEMO_ROOT = process.env.COFLAT_DEMO_ROOT
  ? resolve(process.env.COFLAT_DEMO_ROOT)
  : null;
export const EXTERNAL_FIXTURE_ROOT = process.env.COFLAT_FIXTURE_ROOT
  ? resolve(process.env.COFLAT_FIXTURE_ROOT)
  : null;

function existingRoots(...roots) {
  return roots.filter((root) => typeof root === "string" && root.length > 0);
}

function candidatesFromRoots(path, roots) {
  return roots.map((root) => resolve(root, path));
}

const demoRoots = () => existingRoots(REPO_DEMO_ROOT, EXTERNAL_DEMO_ROOT);
const fixtureRoots = () => existingRoots(REPO_FIXTURE_ROOT, EXTERNAL_FIXTURE_ROOT);
const allFixtureRoots = () => [...demoRoots(), ...fixtureRoots()];

function fixtureCandidates(path, kind = "any") {
  if (kind === "demo") {
    return candidatesFromRoots(path, demoRoots());
  }
  if (kind === "fixture") {
    return candidatesFromRoots(path, fixtureRoots());
  }
  return candidatesFromRoots(path, allFixtureRoots());
}

function repoDisplayPath(kind, virtualPath) {
  return `${kind === "demo" ? "demo" : "fixtures"}/${virtualPath}`;
}

function demoFixture({
  key,
  virtualPath,
  positionKeys,
  defaultLine,
}) {
  return {
    key,
    displayPath: repoDisplayPath("demo", virtualPath),
    virtualPath,
    ...(positionKeys ? { positionKeys } : {}),
    ...(defaultLine ? { defaultLine } : {}),
    candidates: fixtureCandidates(virtualPath, "demo"),
  };
}

function repoFixture({
  key,
  virtualPath,
  positionKeys,
  defaultLine,
}) {
  return {
    key,
    displayPath: repoDisplayPath("fixture", virtualPath),
    virtualPath,
    ...(positionKeys ? { positionKeys } : {}),
    ...(defaultLine ? { defaultLine } : {}),
    candidates: fixtureCandidates(virtualPath, "fixture"),
  };
}

export const PUBLIC_SHOWCASE_FIXTURE = {
  ...demoFixture({ key: "index", virtualPath: "index.md" }),
};

function buildPublicScrollStressFixtureContent() {
  const lines = [
    "---",
    "title: Public Scroll Stress Fixture",
    "---",
    "",
    "# Introduction",
    "",
    "This generated document is committed as code so browser scroll regressions have a public long-document fallback. It intentionally mixes headings, prose, math, tables, and fenced blocks.",
    "",
  ];

  for (let index = 1; index <= 180; index += 1) {
    lines.push(
      `## Section ${index}`,
      "",
      `Paragraph ${index} keeps enough wrapped prose on screen to exercise line measurement while referencing [@eq:scroll-${index}] and inline math $a_${index}+b_${index}=c_${index}$. The sentence is deliberately long enough to wrap in the editor viewport and make scroll geometry observable across rich rendering passes.`,
      "",
      `$$`,
      `x_${index}^2 + y_${index}^2 = z_${index}^2`,
      `$$ {#eq:scroll-${index}}`,
      "",
    );

    if (index % 5 === 0) {
      lines.push(
        `::: {.theorem #thm:scroll-${index}} Synthetic theorem ${index}`,
        `The public fallback theorem ${index} gives the rich renderer a titled fenced div with cross-reference metadata.`,
        ":::",
        "",
        "::: {.proof}",
        `The proof for theorem ${index} has a short body so hidden fence behavior and block-shell geometry are both exercised.`,
        ":::",
        "",
      );
    }

    if (index % 9 === 0) {
      lines.push(
        `::: {.table #tbl:scroll-${index}} Synthetic table ${index}`,
        "| Column | Value |",
        "|---|---:|",
        `| alpha | ${index} |`,
        `| beta | ${index * 2} |`,
        ":::",
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export const PUBLIC_SCROLL_STRESS_FIXTURE = {
  key: "public_scroll_stress",
  displayPath: "generated/public-scroll-stress.md",
  virtualPath: "generated/public-scroll-stress.md",
  content: buildPublicScrollStressFixtureContent(),
  defaultLine: 420,
};

export const RANKDECREASE_MAIN_FIXTURE = repoFixture({
  key: "rankdecrease",
  virtualPath: "rankdecrease/main.md",
  defaultLine: 900,
});

export const COGIRTH_MAIN2_FIXTURE = repoFixture({
  key: "cogirth_main2",
  virtualPath: "cogirth/main2.md",
  defaultLine: 700,
});

export const SCROLL_HEAVY_FIXTURE = COGIRTH_MAIN2_FIXTURE;
export const GEOMETRY_AUDIT_FIXTURES = {
  rankdecrease: RANKDECREASE_MAIN_FIXTURE,
  cogirth: COGIRTH_MAIN2_FIXTURE,
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

function defaultFixtureCandidates(path) {
  return fixtureCandidates(path);
}

function inferFixtureDisplayPath(virtualPath, resolvedPath) {
  if (!resolvedPath) return `fixture:${virtualPath}`;
  if (
    demoRoots().some((root) => resolvedPath.startsWith(`${root}/`))
  ) {
    return `demo/${virtualPath}`;
  }
  if (
    fixtureRoots().some((root) => resolvedPath.startsWith(`${root}/`))
  ) {
    return `fixtures/${virtualPath}`;
  }
  return `fixture:${virtualPath}`;
}

function fixtureRootForResolvedPath(resolvedPath, virtualPath) {
  const knownRoot = allFixtureRoots().find((root) => resolvedPath.startsWith(`${root}/`));
  if (knownRoot) {
    return knownRoot;
  }

  const normalizedResolved = resolvedPath.replace(/\\/g, "/");
  const normalizedVirtual = virtualPath.replace(/\\/g, "/");
  const suffix = `/${normalizedVirtual}`;
  if (!normalizedResolved.endsWith(suffix)) {
    return null;
  }
  return resolve(normalizedResolved.slice(0, -suffix.length));
}

function inferFixtureProjectPrefix(virtualPath) {
  const slashIndex = virtualPath.indexOf("/");
  return slashIndex >= 0 ? virtualPath.slice(0, slashIndex) : null;
}

export function buildFixtureProjectPayload(virtualPath, resolvedPath) {
  const root = fixtureRootForResolvedPath(resolvedPath, virtualPath);
  const projectPrefix = inferFixtureProjectPrefix(virtualPath);
  if (!root) {
    return null;
  }

  const projectRoot = projectPrefix ? resolve(root, projectPrefix) : root;
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    return null;
  }

  const cacheKey = `${projectRoot}:${projectPrefix ?? ""}`;

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
  return payload;
}

export class MissingFixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = "MissingFixtureError";
  }
}

export function isMissingFixtureError(error) {
  return error instanceof MissingFixtureError ||
    (error instanceof Error && error.message.startsWith("Missing fixture for "));
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
    throw new MissingFixtureError(
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
