#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const MODULE_FILE_RE = /\.(?:[cm]?[jt]sx?|d\.[cm]?[jt]s)$/;
const DECLARATION_FILE_RE = /\.d\.[cm]?[jt]s$/;
const TEST_FILE_RE = /(?:^|[./-])(?:[^/]*\.)?(?:test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SPECIAL_SOURCE_LAYERS = ["lexical/runtime"];

export const BOUNDARY_RULES = [
  {
    name: "src/plugins must not import src/render",
    from: ["plugins"],
    to: ["render"],
    allow: [],
  },
  {
    name: "src/state must not import upstream UI/editor layers",
    from: ["state"],
    to: ["app", "editor", "index", "plugins", "render"],
    allow: [],
  },
  {
    name: "src/lib must stay neutral",
    from: ["lib"],
    to: ["app", "citations", "editor", "lexical", "plugins", "render"],
    allow: [
      {
        file: "src/lib/context-menu.ts",
        target: "src/app/components/ui/context-menu.tsx",
        reason: "#1375 tracks moving the app UI context-menu dependency out of lib",
      },
      {
        file: "src/lib/markdown/label-parser.ts",
        target: "src/lexical/markdown/block-scanner.ts",
        reason: "#1373 tracks moving shared label parsing off Lexical internals",
      },
      {
        file: "src/lib/markdown/label-parser.ts",
        target: "src/lexical/markdown/block-syntax.ts",
        reason: "#1373 tracks moving shared label parsing off Lexical internals",
      },
    ],
  },
  {
    name: "src/render must not import app modules",
    from: ["render"],
    to: ["app"],
    allow: [
      {
        file: "src/render/hover-preview-media.ts",
        target: "src/app/pdf-image-previews.ts",
        reason: "#1374 tracks moving collectImageTargets out of the app layer",
      },
    ],
  },
  {
    name: "src/citations must not import app/render/runtime modules",
    from: ["citations"],
    to: ["app", "lexical", "render"],
    allow: [
      {
        file: "src/citations/citation-render-data.ts",
        target: "src/app/markdown/label-parser.ts",
        reason: "#1372/#1373 track removing app markdown shims from citation parsing",
      },
      {
        file: "src/citations/markdown-citations.ts",
        target: "src/app/markdown/labels.ts",
        reason: "#1372/#1373 track removing app markdown shims from citation parsing",
      },
      {
        file: "src/citations/bibliography.ts",
        target: "src/render/render-core.ts",
        reason: "#1396 tracks splitting citation model code from render widgets",
      },
      {
        file: "src/citations/citation-render.ts",
        target: "src/render/render-core.ts",
        reason: "#1396 tracks splitting citation model code from render widgets",
      },
    ],
  },
  {
    name: "src/debug must not depend on app/editor/runtime surfaces",
    from: ["debug"],
    to: ["app", "editor", "lexical"],
    allow: [
      {
        file: "src/debug/debug-bridge-contract.d.ts",
        target: "src/app/hooks/use-sidebar-layout.ts",
        reason: "#1376 tracks moving debug bridge contract types to neutral owners",
      },
      {
        file: "src/debug/debug-bridge-contract.d.ts",
        target: "src/app/hooks/use-editor-scroll.ts",
        reason: "#1376 tracks moving debug bridge contract types to neutral owners",
      },
      {
        file: "src/debug/debug-bridge-contract.d.ts",
        target: "src/lexical/interaction-trace.ts",
        reason: "#1376 tracks moving debug bridge contract types to neutral owners",
      },
      {
        file: "src/debug/debug-bridge-contract.d.ts",
        target: "src/lexical/markdown-editor-types.ts",
        reason: "#1376 tracks moving debug bridge contract types to neutral owners",
      },
      {
        file: "src/debug/debug-bridge-contract.d.ts",
        target: "src/editor/index.ts",
        reason: "#1376 tracks moving debug bridge contract types to neutral owners",
      },
      {
        file: "src/debug/session-recorder.ts",
        target: "src/editor/debug-helpers.ts",
        reason: "#1376 tracks moving debug bridge contract types to neutral owners",
      },
    ],
  },
  {
    name: "src/lexical/runtime must not import app/editor/render modules",
    from: ["lexical/runtime"],
    to: ["app", "editor", "render"],
    allow: [],
  },
];

export const ALLOWED_SOURCE_CYCLES = [
  {
    reason: "#1377 tracks breaking the document/incremental semantics cycle",
    files: [
      "src/ir/document-ir-builder.ts",
      "src/references/classifier.ts",
      "src/semantics/document.ts",
      "src/semantics/incremental/engine.ts",
      "src/semantics/incremental/slices/equation-slice.ts",
      "src/semantics/incremental/slices/fenced-div-slice.ts",
      "src/semantics/incremental/slices/footnote-slice.ts",
      "src/semantics/incremental/slices/heading-slice.ts",
      "src/semantics/incremental/slices/math-slice.ts",
      "src/semantics/incremental/slices/reference-slice.ts",
      "src/semantics/incremental/window-collectors.ts",
      "src/semantics/incremental/window-extractor.ts",
    ],
  },
  {
    reason: "#1378 tracks breaking editor mode/keybinding cycles",
    files: [
      "src/debug/session-recorder.ts",
      "src/editor/block-type-picker.ts",
      "src/editor/debug-helpers.ts",
      "src/editor/debug-panel.ts",
      "src/editor/debug-timeline.ts",
      "src/editor/editor.ts",
      "src/editor/keybindings.ts",
      "src/editor/vertical-motion.ts",
    ],
  },
];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function relativeToRepo(repoRoot, filePath) {
  return toPosixPath(path.relative(repoRoot, filePath));
}

function isModuleFile(filePath) {
  return MODULE_FILE_RE.test(filePath);
}

function isDeclarationFile(filePath) {
  return DECLARATION_FILE_RE.test(filePath);
}

function isTestFile(filePath) {
  return TEST_FILE_RE.test(toPosixPath(filePath));
}

function isRuntimeSourceFile(filePath) {
  return isModuleFile(filePath) && !isDeclarationFile(filePath) && !isTestFile(filePath);
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

function sourceRoot(repoRoot) {
  return path.join(repoRoot, "src");
}

function resolveFileCandidate(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const withExtension = `${candidate}${extension}`;
    if (fs.existsSync(withExtension) && fs.statSync(withExtension).isFile()) {
      return withExtension;
    }
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const indexCandidate = path.join(candidate, `index${extension}`);
    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return indexCandidate;
    }
  }

  return null;
}

export function resolveSourceModulePath(specifier, importerPath, repoRoot) {
  if (specifier.startsWith(".")) {
    return resolveFileCandidate(path.resolve(path.dirname(importerPath), specifier));
  }

  if (specifier === "src" || specifier.startsWith("src/")) {
    return resolveFileCandidate(path.join(repoRoot, specifier));
  }

  return null;
}

function isWithinDirectory(filePath, directoryPath) {
  const relativePath = path.relative(directoryPath, filePath);
  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolvesIntoSourceDirectory(specifier, importerPath, repoRoot, directoryName) {
  const targetRoot = path.join(sourceRoot(repoRoot), directoryName);
  const resolvedTarget = resolveSourceModulePath(specifier, importerPath, repoRoot);
  if (resolvedTarget) {
    return isWithinDirectory(resolvedTarget, targetRoot);
  }

  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(importerPath), specifier);
    return isWithinDirectory(resolved, targetRoot);
  }

  const normalized = specifier.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === `src/${directoryName}` || normalized.startsWith(`src/${directoryName}/`);
}

function sourceLayerForPath(filePath, repoRoot) {
  const relativePath = relativeToRepo(sourceRoot(repoRoot), filePath);
  for (const specialLayer of SPECIAL_SOURCE_LAYERS) {
    if (relativePath === specialLayer || relativePath.startsWith(`${specialLayer}/`)) {
      return specialLayer;
    }
  }
  return relativePath.split("/")[0] ?? "";
}

function layerMatches(layer, expectedLayer) {
  return layer === expectedLayer || layer.startsWith(`${expectedLayer}/`);
}

function ruleAppliesToFile(rule, filePath, repoRoot) {
  const layer = sourceLayerForPath(filePath, repoRoot);
  return rule.from.some((expectedLayer) => layerMatches(layer, expectedLayer));
}

function importMatchesRule(rule, importEntry, importerPath, repoRoot) {
  const targetPath = resolveSourceModulePath(importEntry.specifier, importerPath, repoRoot);
  const targetLayer = targetPath ? sourceLayerForPath(targetPath, repoRoot) : null;
  const matchesTarget = rule.to.some((directoryName) =>
    targetLayer
      ? layerMatches(targetLayer, directoryName)
      : resolvesIntoSourceDirectory(importEntry.specifier, importerPath, repoRoot, directoryName)
  );

  if (!matchesTarget) {
    return null;
  }

  return {
    filePath: importerPath,
    line: importEntry.line,
    rule: rule.name,
    specifier: importEntry.specifier,
    targetPath,
  };
}

function allowlistEntryMatches(entry, violation, repoRoot) {
  const relativeFile = relativeToRepo(repoRoot, violation.filePath);
  const relativeTarget = violation.targetPath
    ? relativeToRepo(repoRoot, violation.targetPath)
    : null;

  if (entry.file && entry.file !== relativeFile) {
    return false;
  }
  if (entry.specifier && entry.specifier !== violation.specifier) {
    return false;
  }
  if (entry.target && entry.target !== relativeTarget) {
    return false;
  }
  return true;
}

function isBoundaryViolationAllowlisted(rule, violation, repoRoot) {
  return rule.allow.some((entry) => allowlistEntryMatches(entry, violation, repoRoot));
}

export function findBoundaryViolations(
  entries,
  repoRoot,
  rules = BOUNDARY_RULES,
) {
  const violations = [];

  for (const entry of entries) {
    if (isTestFile(entry.filePath)) {
      continue;
    }

    const sourceText = entry.sourceText ?? fs.readFileSync(entry.filePath, "utf8");
    for (const importEntry of collectModuleSpecifiers(sourceText, entry.filePath)) {
      for (const rule of rules) {
        if (!ruleAppliesToFile(rule, entry.filePath, repoRoot)) {
          continue;
        }
        const violation = importMatchesRule(rule, importEntry, entry.filePath, repoRoot);
        if (!violation || isBoundaryViolationAllowlisted(rule, violation, repoRoot)) {
          continue;
        }

        violations.push(violation);
      }
    }
  }

  return violations;
}

export function findPluginRenderBoundaryViolations(
  entries,
  repoRoot,
) {
  return findBoundaryViolations(entries, repoRoot, [{
    name: "src/plugins must not import src/render",
    from: ["plugins"],
    to: ["render"],
    allow: [],
  }]).map(({ filePath, line, specifier }) => ({ filePath, line, specifier }));
}

export function findStateUpstreamBoundaryViolations(
  entries,
  repoRoot,
) {
  return findBoundaryViolations(entries, repoRoot, [{
    name: "src/state must not import upstream UI/editor layers",
    from: ["state"],
    to: ["app", "editor", "index", "plugins", "render"],
    allow: [],
  }]).map(({ filePath, line, specifier }) => ({ filePath, line, specifier }));
}

function createImportGraph(entries, repoRoot) {
  const runtimeFiles = entries
    .map((entry) => path.resolve(entry.filePath))
    .filter(isRuntimeSourceFile);
  const runtimeFileSet = new Set(runtimeFiles);
  const graph = new Map(runtimeFiles.map((filePath) => [filePath, []]));

  for (const entry of entries) {
    const filePath = path.resolve(entry.filePath);
    if (!runtimeFileSet.has(filePath)) {
      continue;
    }

    const sourceText = entry.sourceText ?? fs.readFileSync(filePath, "utf8");
    for (const importEntry of collectModuleSpecifiers(sourceText, filePath)) {
      const targetPath = resolveSourceModulePath(importEntry.specifier, filePath, repoRoot);
      if (targetPath && runtimeFileSet.has(path.resolve(targetPath))) {
        graph.get(filePath)?.push(path.resolve(targetPath));
      }
    }
  }

  return graph;
}

function stronglyConnectedComponents(graph) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const lowLinks = new Map();
  const components = [];

  const visit = (filePath) => {
    indexes.set(filePath, index);
    lowLinks.set(filePath, index);
    index += 1;
    stack.push(filePath);
    onStack.add(filePath);

    for (const targetPath of graph.get(filePath) ?? []) {
      if (!indexes.has(targetPath)) {
        visit(targetPath);
        lowLinks.set(filePath, Math.min(lowLinks.get(filePath), lowLinks.get(targetPath)));
      } else if (onStack.has(targetPath)) {
        lowLinks.set(filePath, Math.min(lowLinks.get(filePath), indexes.get(targetPath)));
      }
    }

    if (lowLinks.get(filePath) !== indexes.get(filePath)) {
      return;
    }

    const component = [];
    let currentPath = null;
    do {
      currentPath = stack.pop();
      onStack.delete(currentPath);
      component.push(currentPath);
    } while (currentPath !== filePath);

    const selfCycle = (graph.get(filePath) ?? []).includes(filePath);
    if (component.length > 1 || selfCycle) {
      components.push(component.sort());
    }
  };

  for (const filePath of graph.keys()) {
    if (!indexes.has(filePath)) {
      visit(filePath);
    }
  }

  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function cycleSignature(relativeFiles) {
  return [...relativeFiles].sort().join("\n");
}

function allowedCycleSignatures(allowedCycles) {
  return new Map(allowedCycles.map((cycle) => [cycleSignature(cycle.files), cycle.reason]));
}

export function validateBoundaryConfig(rules = BOUNDARY_RULES, allowedCycles = ALLOWED_SOURCE_CYCLES) {
  const errors = [];
  for (const rule of rules) {
    for (const entry of rule.allow) {
      if (!entry.reason || entry.reason.trim().length === 0) {
        errors.push(`${rule.name} has an allowlist entry without a reason`);
      }
      if (!entry.file || entry.file.endsWith("/") || entry.file.includes("*")) {
        errors.push(`${rule.name} has a broad allowlist file entry: ${entry.file ?? "(missing)"}`);
      }
      if (!entry.target && !entry.specifier) {
        errors.push(`${rule.name} allowlist entry for ${entry.file ?? "(missing)"} needs target or specifier`);
      }
      if (entry.target?.endsWith("/") || entry.target?.includes("*")) {
        errors.push(`${rule.name} has a broad allowlist target entry: ${entry.target}`);
      }
    }
  }

  for (const cycle of allowedCycles) {
    if (!cycle.reason || cycle.reason.trim().length === 0) {
      errors.push("allowed source cycle without a reason");
    }
    if (!Array.isArray(cycle.files) || cycle.files.length < 2) {
      errors.push(`${cycle.reason || "allowed source cycle"} must list at least two files`);
    }
    for (const file of cycle.files ?? []) {
      if (!file || file.endsWith("/") || file.includes("*")) {
        errors.push(`${cycle.reason || "allowed source cycle"} has a broad file entry: ${file ?? "(missing)"}`);
      }
    }
  }

  return errors;
}

export function findSourceCycleViolations(
  entries,
  repoRoot,
  allowedCycles = ALLOWED_SOURCE_CYCLES,
) {
  const allowed = allowedCycleSignatures(allowedCycles);
  return stronglyConnectedComponents(createImportGraph(entries, repoRoot))
    .map((component) => component.map((filePath) => relativeToRepo(repoRoot, filePath)))
    .filter((component) => !allowed.has(cycleSignature(component)));
}

function formatViolation(violation, repoRoot) {
  const relativePath = relativeToRepo(repoRoot, violation.filePath);
  const target = violation.targetPath ? ` -> ${relativeToRepo(repoRoot, violation.targetPath)}` : "";
  return `${relativePath}:${violation.line} imports ${JSON.stringify(violation.specifier)}${target}`;
}

function collectSourceEntries(repoRoot) {
  return walkDirectory(sourceRoot(repoRoot)).map((filePath) => ({ filePath }));
}

function printBoundaryViolations(violations, repoRoot) {
  const byRule = new Map();
  for (const violation of violations) {
    const list = byRule.get(violation.rule) ?? [];
    list.push(violation);
    byRule.set(violation.rule, list);
  }

  for (const [ruleName, ruleViolations] of byRule) {
    console.error(`${ruleName}:`);
    for (const violation of ruleViolations) {
      console.error(`- ${formatViolation(violation, repoRoot)}`);
    }
  }
}

function printCycleViolations(cycles) {
  console.error("Unallowlisted src import cycle(s) found:");
  for (const cycle of cycles) {
    console.error("- cycle:");
    for (const filePath of cycle) {
      console.error(`  - ${filePath}`);
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    console.error("check-plugin-render-boundary.mjs does not accept arguments");
    return 1;
  }

  const repoRoot = process.cwd();
  const entries = collectSourceEntries(repoRoot);
  const configErrors = validateBoundaryConfig();
  const boundaryViolations = findBoundaryViolations(entries, repoRoot);
  const cycleViolations = findSourceCycleViolations(entries, repoRoot);

  if (configErrors.length === 0 && boundaryViolations.length === 0 && cycleViolations.length === 0) {
    return 0;
  }

  if (configErrors.length > 0) {
    console.error("Invalid import-boundary configuration:");
    for (const error of configErrors) {
      console.error(`- ${error}`);
    }
  }
  if (boundaryViolations.length > 0) {
    printBoundaryViolations(boundaryViolations, repoRoot);
  }
  if (cycleViolations.length > 0) {
    printCycleViolations(cycleViolations);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  process.exit(main());
}
