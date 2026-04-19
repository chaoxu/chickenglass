#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createArgParser } from "./cli-args.mjs";

const TEMPLATE_LOADERS = {
  basic: () => import("./regression-tests/templates/basic.mjs"),
};

function usage() {
  return `Usage:
  pnpm test:browser:new -- <name> [--template basic]

Examples:
  pnpm test:browser:new -- inline-math-keyboard-entry
`;
}

function sanitizeName(value) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/-+/g, "-");
  if (!sanitized) {
    throw new Error("Regression test name must contain at least one alphanumeric character.");
  }
  return sanitized;
}

export async function createBrowserRegression({
  name,
  repoRoot = process.cwd(),
  template = "basic",
} = {}) {
  if (!name) {
    throw new Error("Provide a regression test name.");
  }

  const safeName = sanitizeName(name);
  const outputPath = resolve(repoRoot, "scripts/regression-tests", `${safeName}.mjs`);

  const loadTemplate = TEMPLATE_LOADERS[template];
  if (!loadTemplate) {
    throw new Error(`Unknown browser regression template: ${template}`);
  }
  if (existsSync(outputPath)) {
    throw new Error(`Browser regression already exists: ${outputPath}`);
  }

  const module = await loadTemplate();
  if (typeof module.templateSource !== "string") {
    throw new Error(`Invalid browser regression template: ${template}`);
  }

  const source = module.templateSource.replaceAll("__TEST_NAME__", safeName);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source);
  return outputPath;
}

function parseCreateOptions(argv) {
  const parser = createArgParser(argv);
  const positionals = parser.positionals({ valueFlags: ["--template"] });
  return {
    name: positionals[0],
    template: parser.getFlag("--template", "basic"),
  };
}

async function main(argv = process.argv.slice(2)) {
  const parser = createArgParser(argv);
  if (parser.hasFlag("--help") || parser.hasFlag("-h")) {
    console.log(usage());
    return;
  }

  const outputPath = await createBrowserRegression(parseCreateOptions(argv));
  console.log(`Created ${outputPath}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exit(1);
  }
}
