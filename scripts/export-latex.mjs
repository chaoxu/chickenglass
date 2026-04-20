#!/usr/bin/env node
/**
 * Export a Coflat-flavored markdown document to LaTeX via pandoc.
 *
 * Pipeline:
 *   1. Read the source .md.
 *   2. Resolve `::: {.include}` blocks.
 *   3. Lift inline fenced-div titles into `title="..."` attributes.
 *   4. Pipe into pandoc with our Lua filter and template of choice.
 *
 * Usage:
 *   node scripts/export-latex.mjs <input.md> [--output=out.tex]
 *                                 [--template=article|lipics|/path.tex]
 *                                 [--bibliography=refs.bib]
 *                                 [--pandoc=/path/to/pandoc]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildLatexPandocArgs,
  parseLatexFrontmatterConfig,
  resolveLatexExportOptions,
  resolveLatexTemplatePath,
} from "../src/latex/export-options.mjs";
import { preprocess } from "../src/latex/preprocess.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const LATEX_DIR = resolve(REPO_ROOT, "src/latex");
const FILTER_PATH = resolve(LATEX_DIR, "filter.lua");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export function buildPandocResourcePath(sourceDir, projectRoot) {
  return sourceDir === projectRoot
    ? sourceDir
    : [sourceDir, projectRoot].join(delimiter);
}

async function runPandoc({
  bibliography,
  markdown,
  output,
  pandocBin,
  projectRoot,
  sourceDir,
  template,
}) {
  const args = buildLatexPandocArgs({
    bibliography,
    filterPath: FILTER_PATH,
    output,
    resourcePath: buildPandocResourcePath(sourceDir, projectRoot),
    template,
  });

  const child = spawn(pandocBin, args, {
    cwd: sourceDir,
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin.write(markdown);
  child.stdin.end();
  return new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`pandoc exited with code ${code}`));
    });
  });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length === 0) {
    console.error("usage: export-latex <input.md> [--output=] [--template=] [--bibliography=]");
    process.exit(2);
  }

  const input = resolve(process.cwd(), positional[0]);
  const output = resolve(process.cwd(), flags.output ?? input.replace(/\.md$/, ".tex"));
  const pandocBin = flags.pandoc ?? "pandoc";
  const projectRoot = process.cwd();
  const sourceDir = dirname(input);

  const source = await readFile(input, "utf8");
  const exportOptions = resolveLatexExportOptions({
    config: parseLatexFrontmatterConfig(source),
    flags,
  });
  const template = resolveLatexTemplatePath(exportOptions.template, {
    latexDir: LATEX_DIR,
    pathResolve: resolve,
  });
  const bibliography = exportOptions.bibliography;
  const processed = await preprocess(source, input);

  await mkdir(dirname(output), { recursive: true });

  if (flags["dump-markdown"]) {
    await writeFile(output.replace(/\.tex$/, ".pandoc.md"), processed, "utf8");
  }

  await runPandoc({
    bibliography,
    markdown: processed,
    output,
    pandocBin,
    projectRoot,
    sourceDir,
    template,
  });
  console.error(`wrote ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
