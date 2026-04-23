#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".worktrees",
  "build",
  "dist",
  "dist-server",
  "node_modules",
  "target",
]);

function scriptKindFor(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          stack.push(path.join(current, entry.name));
        }
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  return files.sort();
}

function lineFor(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function findBareCatchClauses(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const violations = [];

  const visit = (node) => {
    if (ts.isCatchClause(node) && !node.variableDeclaration) {
      violations.push({
        filePath,
        line: lineFor(sourceFile, node),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function collectViolations(repoRoot) {
  const roots = ["src", "scripts", "server"]
    .map((name) => path.join(repoRoot, name))
    .filter((dir) => fs.existsSync(dir));
  return roots.flatMap((root) =>
    walk(root).flatMap((filePath) =>
      findBareCatchClauses(filePath, fs.readFileSync(filePath, "utf8")),
    ),
  );
}

export function main() {
  const repoRoot = process.cwd();
  const violations = collectViolations(repoRoot);
  if (violations.length === 0) {
    return 0;
  }

  console.error("Bare catch clause(s) found. Use an explicit ignored-error binding, e.g. catch (_error) { ... }.");
  for (const violation of violations) {
    console.error(`- ${toPosixPath(path.relative(repoRoot, violation.filePath))}:${violation.line}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  process.exit(main());
}
