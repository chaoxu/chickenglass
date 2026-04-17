/* global window */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import {
  PUBLIC_SHOWCASE_FIXTURE,
  REPO_DEMO_ROOT,
  REPO_FIXTURE_ROOT,
  REPO_ROOT,
  sleep,
  TEXT_FIXTURE_EXTENSIONS,
  waitForEditorSurface,
} from "./shared.mjs";

function defaultFixtureCandidates(path) {
  return [
    resolve(REPO_DEMO_ROOT, path),
    resolve(REPO_FIXTURE_ROOT, path),
  ];
}

function inferFixtureDisplayPath(virtualPath, resolvedPath) {
  if (!resolvedPath) return `fixture:${virtualPath}`;
  if (resolvedPath.startsWith(`${REPO_DEMO_ROOT}/`)) {
    return `demo/${virtualPath}`;
  }
  if (resolvedPath.startsWith(`${REPO_FIXTURE_ROOT}/`)) {
    return `fixtures/${virtualPath}`;
  }
  return `fixture:${virtualPath}`;
}

function fixtureRootForResolvedPath(resolvedPath) {
  if (resolvedPath.startsWith(`${REPO_DEMO_ROOT}/`)) return REPO_DEMO_ROOT;
  if (resolvedPath.startsWith(`${REPO_FIXTURE_ROOT}/`)) return REPO_FIXTURE_ROOT;
  return null;
}

function inferFixtureProjectPrefix(virtualPath) {
  const slashIndex = virtualPath.indexOf("/");
  return slashIndex >= 0 ? virtualPath.slice(0, slashIndex) : null;
}

function buildFixtureProjectFiles(virtualPath, resolvedPath) {
  const root = fixtureRootForResolvedPath(resolvedPath);
  const projectPrefix = inferFixtureProjectPrefix(virtualPath);
  if (!root) {
    return null;
  }

  const projectRoot = projectPrefix ? resolve(root, projectPrefix) : root;
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    return null;
  }

  const files = [];

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const repoRelativePath = relative(root, absolutePath).replace(/\\/g, "/");
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
  return files;
}

function isMissingFixtureError(error) {
  return error instanceof Error && error.message.startsWith("Missing fixture for ");
}

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
      resolvedPath: null,
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

export async function openFixtureDocument(page, fixture, options = {}) {
  const resolved = resolveFixtureDocument(fixture);
  const { mode, discardCurrent = true, project = "single-file" } = options;
  const preferOpenFile = Boolean(
    resolved.resolvedPath?.startsWith(resolve(REPO_ROOT, "demo")),
  );
  const fixtureProjectFiles = project === "full-project" && resolved.resolvedPath
    ? buildFixtureProjectFiles(resolved.virtualPath, resolved.resolvedPath)
    : null;
  const verificationWindow = 200;

  if (discardCurrent) {
    const { discardCurrentFile } = await import("../test-helpers.mjs");
    await discardCurrentFile(page).catch(() => false);
  }

  const result = await page.evaluate(
    async ({ path, expectedContent, tryOpenFileFirst, fixtureProjectFiles }) => {
      const app = window.__app;
      if (!app?.openFile) {
        throw new Error("window.__app.openFile is unavailable.");
      }

      const canOpenInCurrentProject = tryOpenFileFirst
        || (fixtureProjectFiles && app.hasFile ? await app.hasFile(path) : false);

      if (canOpenInCurrentProject) {
        try {
          await app.openFile(path);
          return { method: "openFile" };
        } catch (error) {
          if (!app.loadFixtureProject && !app.openFileWithContent) {
            throw error;
          }
        }
      }

      if (app.loadFixtureProject && fixtureProjectFiles) {
        await app.loadFixtureProject(fixtureProjectFiles, path);
        return { method: "loadFixtureProject" };
      }

      if (!app.openFileWithContent) {
        throw new Error(`window.__app.openFileWithContent is unavailable while opening ${path}.`);
      }

      await app.openFileWithContent(path, expectedContent);
      return { method: "openFileWithContent" };
    },
    {
      path: resolved.virtualPath,
      expectedContent: resolved.content,
      tryOpenFileFirst: preferOpenFile,
      fixtureProjectFiles,
    },
  );

  await waitForEditorSurface(page);
  await page.waitForFunction(
    ({ method, path, expectedLength, expectedPrefix, expectedSuffix }) => {
      const text = window.__editor?.getDoc();
      const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
      const sourceMapRegions = window.__cfSourceMap?.regions.length ?? 0;
      if (typeof text !== "string" || currentPath !== path) {
        return false;
      }

      if (method !== "openFile" && sourceMapRegions === 0) {
        return text.length === expectedLength &&
          text.startsWith(expectedPrefix) &&
          text.endsWith(expectedSuffix);
      }

      return text.length > 0;
    },
    {
      method: result.method,
      path: resolved.virtualPath,
      expectedLength: resolved.content.length,
      expectedPrefix: resolved.content.slice(0, verificationWindow),
      expectedSuffix: resolved.content.slice(-verificationWindow),
    },
    { timeout: 10000 },
  );
  if (mode) {
    const { switchToMode } = await import("../test-helpers.mjs");
    await switchToMode(page, mode);
  }
  await sleep(200);

  return {
    ...resolved,
    method: result.method,
  };
}

export async function openRegressionDocument(page, path = "index.md", options = {}) {
  const opened = await openFixtureDocument(page, path, { project: "full-project", ...options });
  return opened.virtualPath;
}

export async function openAndSettleRegressionDocument(page, path = "index.md", options = {}) {
  const virtualPath = await openRegressionDocument(page, path, options);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return virtualPath;
}
