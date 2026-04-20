import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILTER_PATH = resolve(__dirname, "filter.lua");
const hasPandoc = spawnSync("pandoc", ["--version"], { encoding: "utf8" }).status === 0;

function runPandoc(markdown) {
  const result = spawnSync(
    "pandoc",
    [
      "--from=markdown+fenced_divs+raw_tex",
      "--to=latex",
      `--lua-filter=${FILTER_PATH}`,
    ],
    {
      encoding: "utf8",
      input: markdown,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `pandoc exited ${result.status}`);
  }
  return result.stdout;
}

describe("LaTeX filter embed-family blocks", () => {
  it.skipIf(!hasPandoc)("emits an omitted-content notice and URL footnote", () => {
    const latex = runPandoc("::: {.youtube}\nhttps://youtu.be/example\n:::\n");

    expect(latex).toContain("\\PackageWarning{coflat}{Youtube content omitted in LaTeX export}");
    expect(latex).toContain("\\emph{Youtube content omitted in LaTeX export.}");
    expect(latex).toContain("\\footnote{\\url{https://youtu.be/example}}");
  });
});
