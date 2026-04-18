import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

import { git, resolveRepoRoot } from "./shared.mjs";

const REPAIRABLE_NODE_MODULES_ENTRIES = new Set([
  ".cache",
  ".vite",
  ".vite-temp",
  "node_modules",
]);

function resolveGitCommonDir(repoRoot) {
  const commonDir = git(repoRoot, "rev-parse", "--git-common-dir");
  return isAbsolute(commonDir) ? commonDir : resolve(repoRoot, commonDir);
}

export function resolvePrimaryRepoRoot(repoRoot = process.cwd()) {
  const resolvedRepoRoot = resolve(resolveRepoRoot(repoRoot));
  const commonDir = resolveGitCommonDir(resolvedRepoRoot);
  return basename(commonDir) === ".git"
    ? dirname(commonDir)
    : resolvedRepoRoot;
}

function isRepairableNodeModulesDirectory(path) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    return false;
  }

  const entries = readdirSync(path);
  return entries.length === 0
    || entries.every((entry) => REPAIRABLE_NODE_MODULES_ENTRIES.has(entry));
}

function sameRealPath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function createNodeModulesLink(source, target) {
  symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
}

export function ensureNodeModulesLink({
  repoRoot = process.cwd(),
  primaryRepoRoot,
} = {}) {
  const resolvedRepoRoot = resolve(resolveRepoRoot(repoRoot));
  const resolvedPrimaryRoot = resolve(primaryRepoRoot ?? resolvePrimaryRepoRoot(resolvedRepoRoot));
  const source = join(resolvedPrimaryRoot, "node_modules");
  const target = join(resolvedRepoRoot, "node_modules");

  if (resolvedRepoRoot === resolvedPrimaryRoot) {
    return existsSync(target)
      ? {
          action: "primary-present",
          ok: true,
          source,
          target,
        }
      : {
          action: "primary-missing",
          message: `Primary checkout is missing dependencies: ${target}`,
          ok: false,
          source,
          target,
        };
  }

  if (!existsSync(source)) {
    return {
      action: "source-missing",
      message: `Cannot link dependencies because ${source} does not exist. Run pnpm install in the primary checkout.`,
      ok: false,
      source,
      target,
    };
  }

  if (!existsSync(target)) {
    createNodeModulesLink(source, target);
    return {
      action: "linked",
      ok: true,
      source,
      target,
    };
  }

  if (sameRealPath(target, source)) {
    return {
      action: "already-linked",
      ok: true,
      source,
      target,
    };
  }

  if (isRepairableNodeModulesDirectory(target)) {
    rmSync(target, { recursive: true, force: true });
    createNodeModulesLink(source, target);
    return {
      action: "repaired",
      ok: true,
      source,
      target,
    };
  }

  return {
    action: "target-exists",
    message: `Refusing to replace existing node_modules at ${target}. Remove it manually if it should be linked to ${source}.`,
    ok: false,
    source,
    target,
  };
}
