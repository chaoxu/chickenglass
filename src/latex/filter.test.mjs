import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LATEX_PANDOC_FROM } from "./export-options.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILTER_PATH = resolve(__dirname, "filter.lua");
const hasPandoc = spawnSync("pandoc", ["--version"], { encoding: "utf8" }).status === 0;

function runPandoc(markdown) {
  const result = spawnSync(
    "pandoc",
    [
      `--from=${LATEX_PANDOC_FROM}`,
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

describe("LaTeX filter custom blocks", () => {
  it.skipIf(!hasPandoc)("leaves unknown fenced div content as ordinary content", () => {
    const latex = runPandoc("::: {.custom-widget}\nBody content\n:::\n");

    expect(latex).toContain("Body content");
    expect(latex).not.toContain("content omitted");
  });

  it.skipIf(!hasPandoc)("escapes plain theorem title attributes", () => {
    const latex = runPandoc('::: {.theorem #thm:main title="A & B_#%$"}\nBody\n:::\n');

    expect(latex).toContain("\\begin{theorem}[A \\& B\\_\\#\\%\\$]\\label{thm:main}");
  });

  it.skipIf(!hasPandoc)("escapes plain figure caption attributes", () => {
    const latex = runPandoc('::: {.figure #fig:main title="A & B_#%$"}\n![Alt](image.png)\n:::\n');

    expect(latex).toContain("\\caption{A \\& B\\_\\#\\%\\$}\\label{fig:main}");
  });
});

describe("LaTeX filter inline mappings", () => {
  it.skipIf(!hasPandoc)("lets Pandoc mark spans render as soul highlights", () => {
    const latex = runPandoc("A ==highlighted **term**==.\n");

    expect(latex).toContain("\\hl{highlighted \\textbf{term}}");
  });

  it.skipIf(!hasPandoc)("renders mixed xref and citation clusters in order", () => {
    const latex = runPandoc([
      "::: {.theorem #thm:main}",
      "Body",
      ":::",
      "",
      "See [@thm:main; @karger2000].",
    ].join("\n"));

    expect(latex).toContain("\\cref{thm:main}; \\cite{karger2000}");
  });
});
