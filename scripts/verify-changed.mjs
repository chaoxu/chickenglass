#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  browserAreaTouched,
  selectBrowserLanesForChangedFiles,
} from "./browser-lanes.mjs";
import { createArgParser, normalizeCliArgs } from "./devx-cli.mjs";

const VALUE_FLAGS = ["--base", "--profile", "--since"];
const BOOLEAN_FLAGS = ["--help", "-h", "--json", "--no-base", "--run", "--staged"];

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const TEST_FILE_PATTERN = /\.(?:spec|test)\.(?:[cm]?[jt]sx?)$/;
const CODE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const RUST_FILE_PATTERN = /\.rs$/;
const MARKDOWN_FILE_PATTERN = /\.(?:md|mdx)$/;

const AREA_TESTS = [
  {
    command: ["rtk", "pnpm", "test:focused", "--", "src/parser/fenced-div.test.ts"],
    paths: ["src/parser/", "FORMAT.md"],
  },
  {
    command: [
      "rtk",
      "pnpm",
      "test:focused",
      "--",
      "src/render/reference-render.test.ts",
      "src/render/hover-preview.test.ts",
      "src/render/hover-preview.render.test.ts",
    ],
    paths: ["src/render/"],
  },
  {
    command: [
      "rtk",
      "pnpm",
      "test:focused",
      "--",
      "scripts/test-regression.test.mjs",
      "scripts/browser-repro.test.mjs",
    ],
    paths: [
      "scripts/browser-health.mjs",
      "scripts/browser-lifecycle.mjs",
      "scripts/browser-repro.mjs",
      "scripts/devx-browser-session.mjs",
      "scripts/test-regression.mjs",
      "scripts/regression-tests/",
    ],
  },
  {
    command: [
      "rtk",
      "pnpm",
      "test:focused",
      "--",
      "scripts/perf-regression.test.mjs",
      "scripts/perf-regression-lib.test.mjs",
    ],
    paths: ["scripts/perf-regression", "scripts/runtime-budget-profiles"],
  },
];

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createPlanCommand(argv) {
  return {
    argv,
    display: argv.map(shellQuote).join(" "),
  };
}

export function commandDisplay(command) {
  return command.display;
}

function uniqueCommands(commands) {
  const seen = new Set();
  const result = [];
  for (const command of commands) {
    if (seen.has(command.display)) {
      continue;
    }
    seen.add(command.display);
    result.push(command);
  }
  return result;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function lineList(output) {
  return output
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function runGit(args, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  const result = spawn("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    const message = result.stderr?.trim() || `git ${args.join(" ")} failed`;
    throw new Error(message);
  }
  return result.stdout ?? "";
}

export function collectChangedFiles(options = {}) {
  const files = [];
  if (options.staged) {
    return unique(
      lineList(runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"], options)),
    ).sort();
  }

  const includeBase = options.base && !options.noBase;
  if (includeBase) {
    files.push(
      ...lineList(
        runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB", `${options.base}...HEAD`], options),
      ),
    );
  }
  files.push(
    ...lineList(runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB"], options)),
    ...lineList(runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"], options)),
    ...lineList(runGit(["ls-files", "--others", "--exclude-standard"], options)),
  );
  return unique(files).sort();
}

function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path);
}

function isCodeFile(path) {
  return CODE_FILE_PATTERN.test(path);
}

function isRustFile(path) {
  return RUST_FILE_PATTERN.test(path);
}

function isMarkdownFile(path) {
  return MARKDOWN_FILE_PATTERN.test(path);
}

function withoutCodeExtension(path) {
  for (const extension of SOURCE_EXTENSIONS) {
    if (path.endsWith(extension)) {
      return path.slice(0, -extension.length);
    }
  }
  return path;
}

export function candidateSiblingTests(path) {
  const normalized = normalizePath(path);
  if (!isCodeFile(normalized) || isTestFile(normalized)) {
    return [];
  }
  const base = withoutCodeExtension(normalized);
  return [
    `${base}.test.ts`,
    `${base}.test.tsx`,
    `${base}.test.mjs`,
    `${base}.spec.ts`,
    `${base}.spec.tsx`,
  ];
}

function findExistingTests(paths, exists = existsSync) {
  const tests = [];
  for (const path of paths) {
    if (isTestFile(path)) {
      tests.push(path);
      continue;
    }
    for (const candidate of candidateSiblingTests(path)) {
      if (exists(candidate)) {
        tests.push(candidate);
      }
    }
  }
  return unique(tests).sort();
}

function touchesAny(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function packageBoundaryTouched(paths) {
  return paths.some((path) =>
    path === "package.json" ||
    path === "pnpm-lock.yaml" ||
    path === "lefthook.yml" ||
    path === "knip.config.ts" ||
    path === "biome.json" ||
    path.startsWith(".gitea/") ||
    path.startsWith("tsconfig") ||
    path.startsWith("vite") ||
    path.startsWith("server/tsconfig"),
  );
}

function editorPackageTouched(paths) {
  return paths.some((path) =>
    path === "vite.editor.config.ts" ||
    path === "tsconfig.editor.json" ||
    path.startsWith("src/editor-package") ||
    path.startsWith("src/product/") ||
    path.startsWith("scripts/editor-package"),
  );
}

export function browserLanesForChangedFiles(paths, options = {}) {
  return selectBrowserLanesForChangedFiles(paths.map(normalizePath), options);
}

function rustTouched(paths) {
  return paths.some((path) => path.startsWith("src-tauri/") && isRustFile(path));
}

function browserFixtureGuardPath(path) {
  return path.startsWith("scripts/regression-tests/") ||
    path === "scripts/test-regression.mjs" ||
    path === "scripts/fixture-test-helpers.mjs" ||
    path === "scripts/editor-test-helpers.mjs" ||
    path.includes("browser") && path.startsWith("scripts/");
}

function docsOnly(paths) {
  return paths.length > 0 &&
    paths.every((path) =>
      isMarkdownFile(path) ||
      path.startsWith("docs/") ||
      path === "AGENTS.md" ||
      path === "CLAUDE.md" ||
      path === "FORMAT.md",
    );
}

function addAreaTests(paths, commands) {
  for (const area of AREA_TESTS) {
    if (paths.some((path) => touchesAny(path, area.paths))) {
      commands.push(createPlanCommand(area.command));
    }
  }
}

function addBrowserLaneCommands(lanes, commands) {
  for (const lane of lanes) {
    commands.push(createPlanCommand(["rtk", "pnpm", "test:browser:quick", "--", lane]));
  }
}

export function buildChangedVerificationPlan(paths, options = {}) {
  const normalizedPaths = unique(paths.map(normalizePath)).sort();
  const profile = options.profile ?? "quick";
  const exists = options.exists ?? existsSync;
  const commands = options.diffCommands ?? [
    createPlanCommand(["rtk", "git", "diff", "--check", "HEAD"]),
  ];
  const notes = [];

  if (normalizedPaths.length === 0) {
    return {
      commands: [],
      files: [],
      notes: ["No changed files detected."],
      profile,
    };
  }

  const focusedTests = findExistingTests(normalizedPaths, exists);
  if (focusedTests.length > 0) {
    commands.push(createPlanCommand([
      "rtk",
      "pnpm",
      "test:focused",
      "--",
      ...focusedTests,
    ]));
  }
  addAreaTests(normalizedPaths, commands);
  const fixtureGuardPaths = normalizedPaths.filter(browserFixtureGuardPath);
  if (fixtureGuardPaths.length > 0) {
    commands.push(createPlanCommand([
      "rtk",
      "pnpm",
      "check:browser-fixtures",
      "--",
      ...fixtureGuardPaths,
    ]));
  }

  if (profile === "edit") {
    if (focusedTests.length === 0 && normalizedPaths.some(isCodeFile)) {
      notes.push("No direct focused test was found for changed code; use quick or full profile before relying on this change.");
    }
    if (normalizedPaths.some(isCodeFile) || packageBoundaryTouched(normalizedPaths)) {
      notes.push("Edit profile skipped typecheck and architectural lints; run quick profile before push.");
    }
    if (browserAreaTouched(normalizedPaths)) {
      notes.push("Browser-facing files changed; run `pnpm test:browser:quick` or full profile before closing runtime issues.");
    }
    return {
      commands: uniqueCommands(commands),
      files: normalizedPaths,
      notes: unique(notes),
      profile,
    };
  }

  const codeTouched = normalizedPaths.some(isCodeFile);
  if (codeTouched || packageBoundaryTouched(normalizedPaths)) {
    commands.push(createPlanCommand(["rtk", "pnpm", "check:pre-push"]));
  }

  if (editorPackageTouched(normalizedPaths)) {
    commands.push(createPlanCommand(["rtk", "pnpm", "check:package"]));
  } else if (normalizedPaths.includes("package.json") || normalizedPaths.includes("pnpm-lock.yaml")) {
    notes.push("Package metadata changed; run `pnpm check:package` if exports, editor packaging, or publish surface changed.");
  }

  if (rustTouched(normalizedPaths)) {
    commands.push(createPlanCommand(["rtk", "cargo", "nextest", "run"]));
  }

  const browserLanes = browserLanesForChangedFiles(normalizedPaths, { profile });
  if (profile === "full") {
    commands.push(createPlanCommand(["rtk", "pnpm", "check:merge"]));
    if (browserLanes.length > 0) {
      commands.push(createPlanCommand(["rtk", "pnpm", "test:browser:quick", "--", "all"]));
    }
  } else {
    if (browserLanes.length > 0) {
      addBrowserLaneCommands(browserLanes, commands);
      notes.push(`Browser-facing files changed; selected browser lanes: ${browserLanes.join(", ")}.`);
      notes.push("Use full profile for the complete browser suite before closing broad runtime issues.");
    }
    if (docsOnly(normalizedPaths)) {
      notes.push("Docs-only change; quick plan stays at whitespace/diff verification.");
    }
    notes.push("Use `pnpm verify:changed -- --profile full` before closing broad or high-risk issues.");
  }

  return {
    commands: uniqueCommands(commands),
    files: normalizedPaths,
    notes: unique(notes),
    profile,
  };
}

export function formatChangedVerificationPlan(plan) {
  const lines = [];
  lines.push(`Changed files: ${plan.files.length}`);
  for (const file of plan.files) {
    lines.push(`- ${file}`);
  }
  if (plan.commands.length > 0) {
    lines.push("");
    lines.push(`Verification plan (${plan.profile}):`);
    for (const command of plan.commands) {
      lines.push(`- ${commandDisplay(command)}`);
    }
  }
  if (plan.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of plan.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join("\n");
}

export function runPlanCommands(commands, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  for (const command of commands) {
    const result = spawn(command.argv[0], command.argv.slice(1), {
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

export function printVerifyChangedHelp(stream = process.stdout) {
  stream.write(`Usage:
  pnpm verify:changed
  pnpm verify:changed -- --run
  pnpm verify:changed -- --profile full
  pnpm verify:changed -- src/render/reference-render.ts

Options:
  --base <ref>      include committed changes against a base ref (default: origin/main)
  --since <ref>     alias for --base, for "what changed since this ref" workflows
  --staged          only inspect staged changes
  --no-base         only inspect working tree, staged changes, and untracked files
  --profile quick   fast local plan (default)
  --profile edit    inner-loop plan: diff checks + focused tests only
  --profile full    adds full merge/browser checks when relevant
  --run             execute the generated commands
  --json            print the plan as JSON
`);
}

export function runVerifyChangedCli(argv = process.argv.slice(2), options = {}) {
  const args = normalizeCliArgs(argv);
  if (args.includes("--help") || args.includes("-h")) {
    printVerifyChangedHelp(options.stdout ?? process.stdout);
    return 0;
  }

  const parser = createArgParser(args, {
    booleanFlags: BOOLEAN_FLAGS,
    valueFlags: VALUE_FLAGS,
  });
  parser.assertKnownFlags([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);

  const positionals = parser.getPositionals();
  const baseRef = parser.getFlag("--since", parser.getFlag("--base", "origin/main"));
  const files = positionals.length > 0
    ? positionals
    : collectChangedFiles({
      base: baseRef,
      noBase: parser.hasFlag("--no-base") || parser.hasFlag("--staged"),
      spawnSync: options.spawnSync,
      staged: parser.hasFlag("--staged"),
    });

  const plan = buildChangedVerificationPlan(files, {
    diffCommands: parser.hasFlag("--no-base")
      ? [createPlanCommand(["rtk", "git", "diff", "--check", "HEAD"])]
      : parser.hasFlag("--staged")
        ? [createPlanCommand(["rtk", "git", "diff", "--cached", "--check"])]
      : [
        createPlanCommand(["rtk", "git", "diff", "--check", `${baseRef}...HEAD`]),
        createPlanCommand(["rtk", "git", "diff", "--check", "HEAD"]),
      ],
    exists: options.exists,
    profile: parser.getFlag("--profile", "quick"),
  });

  const stdout = options.stdout ?? process.stdout;
  if (parser.hasFlag("--json")) {
    stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    stdout.write(`${formatChangedVerificationPlan(plan)}\n`);
  }

  if (!parser.hasFlag("--run") || plan.commands.length === 0) {
    return 0;
  }
  return runPlanCommands(plan.commands, options);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(runVerifyChangedCli());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
