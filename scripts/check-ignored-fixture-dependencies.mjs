#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const FIXTURE_REFERENCE_PATTERN = /(?:^|["'`(])((?:fixtures\/)[^"'`)\s,;]+)/gu;

export function collectFixtureReferences(content) {
  const references = [];
  for (const match of content.matchAll(FIXTURE_REFERENCE_PATTERN)) {
    const reference = match[1]?.replace(/[.:]+$/u, "");
    if (reference) {
      references.push(reference);
    }
  }
  return [...new Set(references)];
}

function defaultIsIgnored(path) {
  const result = spawnSync("git", ["check-ignore", "-q", path], {
    stdio: "ignore",
  });
  return (result.status ?? 1) === 0;
}

export function findIgnoredFixtureDependencies(paths, options = {}) {
  const readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
  const isIgnored = options.isIgnored ?? defaultIsIgnored;
  const violations = [];

  for (const path of paths) {
    const content = readFile(path);
    for (const fixturePath of collectFixtureReferences(content)) {
      if (isIgnored(fixturePath)) {
        violations.push({
          file: path,
          fixturePath,
        });
      }
    }
  }

  return violations;
}

function stagedBrowserFiles() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || "git diff --cached --name-only failed");
  }
  return String(result.stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.startsWith("scripts/regression-tests/") ||
      line.startsWith("scripts/") && line.includes("browser") ||
      line.startsWith("scripts/") && line.includes("fixture") ||
      line === "scripts/test-regression.mjs"
    );
}

export function runIgnoredFixtureDependencyCheck(argv = process.argv.slice(2), options = {}) {
  const normalizedArgv = argv.filter((arg) => arg !== "--");
  const paths = normalizedArgv.length > 0 ? normalizedArgv : stagedBrowserFiles();
  const violations = findIgnoredFixtureDependencies(paths, options);
  if (violations.length === 0) {
    return 0;
  }

  const stderr = options.stderr ?? process.stderr;
  stderr.write("Browser/devx files reference ignored local fixtures directly:\n");
  for (const violation of violations) {
    stderr.write(`- ${violation.file}: ${violation.fixturePath}\n`);
  }
  stderr.write("Use committed demo fixtures, generated inline projects, or optional fixture constants from fixture-test-helpers.mjs.\n");
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  process.exit(runIgnoredFixtureDependencyCheck());
}
