#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const MODULE_FILE_RE = /\.(?:[cm]?[jt]sx?|d\.[cm]?[jt]s)$/;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isModuleFile(filePath) {
  return MODULE_FILE_RE.test(filePath);
}

function walkDirectory(rootDir) {
  const entries = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir || !fs.existsSync(currentDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && isModuleFile(entryPath)) {
        entries.push(entryPath);
      }
    }
  }

  entries.sort();
  return entries;
}

function getLineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function collectModuleSpecifiers(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers = [];

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push({
        specifier: node.moduleSpecifier.text,
        line: getLineNumber(sourceFile, node.moduleSpecifier),
      });
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push({
        specifier: node.arguments[0].text,
        line: getLineNumber(sourceFile, node.arguments[0]),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function resolvesIntoSourceDirectory(specifier, importerPath, repoRoot, directoryName) {
  const targetRoot = path.join(repoRoot, "src", directoryName);
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(importerPath), specifier);
    const relativeToTarget = path.relative(targetRoot, resolved);
    return relativeToTarget === ""
      || (!relativeToTarget.startsWith("..") && !path.isAbsolute(relativeToTarget));
  }

  const normalized = specifier.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === `src/${directoryName}` || normalized.startsWith(`src/${directoryName}/`);
}

function resolvesIntoRender(specifier, importerPath, repoRoot) {
  return resolvesIntoSourceDirectory(specifier, importerPath, repoRoot, "render");
}

function resolvesIntoStateUpstream(specifier, importerPath, repoRoot) {
  return ["app", "editor", "index", "plugins", "render"].some((directoryName) =>
    resolvesIntoSourceDirectory(specifier, importerPath, repoRoot, directoryName)
  );
}

export function findPluginRenderBoundaryViolations(
  entries,
  repoRoot,
) {
  const violations = [];

  for (const entry of entries) {
    const sourceText = entry.sourceText ?? fs.readFileSync(entry.filePath, "utf8");
    for (const importEntry of collectModuleSpecifiers(sourceText, entry.filePath)) {
      if (!resolvesIntoRender(importEntry.specifier, entry.filePath, repoRoot)) {
        continue;
      }

      violations.push({
        filePath: entry.filePath,
        line: importEntry.line,
        specifier: importEntry.specifier,
      });
    }
  }

  return violations;
}

export function findStateUpstreamBoundaryViolations(
  entries,
  repoRoot,
) {
  const violations = [];

  for (const entry of entries) {
    const sourceText = entry.sourceText ?? fs.readFileSync(entry.filePath, "utf8");
    for (const importEntry of collectModuleSpecifiers(sourceText, entry.filePath)) {
      if (!resolvesIntoStateUpstream(importEntry.specifier, entry.filePath, repoRoot)) {
        continue;
      }

      violations.push({
        filePath: entry.filePath,
        line: importEntry.line,
        specifier: importEntry.specifier,
      });
    }
  }

  return violations;
}

function formatViolation(violation, repoRoot) {
  const relativePath = toPosixPath(path.relative(repoRoot, violation.filePath));
  return `${relativePath}:${violation.line} imports ${JSON.stringify(violation.specifier)}`;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    console.error("check-plugin-render-boundary.mjs does not accept arguments");
    return 1;
  }

  const repoRoot = process.cwd();
  const pluginRoot = path.join(repoRoot, "src", "plugins");
  const pluginFiles = walkDirectory(pluginRoot).map((filePath) => ({ filePath }));
  const pluginViolations = findPluginRenderBoundaryViolations(pluginFiles, repoRoot);

  const stateRoot = path.join(repoRoot, "src", "state");
  const stateFiles = walkDirectory(stateRoot).map((filePath) => ({ filePath }));
  const stateViolations = findStateUpstreamBoundaryViolations(stateFiles, repoRoot);

  if (pluginViolations.length === 0 && stateViolations.length === 0) {
    return 0;
  }

  if (pluginViolations.length > 0) {
    console.error("Disallowed src/plugins -> src/render import(s) found:");
    for (const violation of pluginViolations) {
      console.error(`- ${formatViolation(violation, repoRoot)}`);
    }
  }

  if (stateViolations.length > 0) {
    console.error("Disallowed src/state -> upstream subsystem import(s) found:");
    for (const violation of stateViolations) {
      console.error(`- ${formatViolation(violation, repoRoot)}`);
    }
  }
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  process.exit(main());
}
