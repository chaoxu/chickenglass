import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildLatexPandocArgs,
  LATEX_PANDOC_FROM,
  latexBibliographyMetadataValue,
  parseLatexFrontmatterConfig,
  resolveLatexExportOptions,
  resolveLatexTemplatePath,
} from "./export-options.mjs";

const rustExportSource = () =>
  readFileSync(join(process.cwd(), "src-tauri/src/commands/export.rs"), "utf8");

function extractRustLatexPandocFrom(source) {
  const match = source.match(/const LATEX_PANDOC_FROM: &str =\s*"([^"]+)";/);
  if (!match) {
    throw new Error("Rust export command is missing LATEX_PANDOC_FROM");
  }
  return match[1];
}

function extractRustBuildLatexPandocArgsBody(source) {
  const start = source.indexOf("fn build_latex_pandoc_args(");
  if (start < 0) {
    throw new Error("Rust export command is missing build_latex_pandoc_args");
  }
  const testsStart = source.indexOf("#[cfg(test)]", start);
  if (testsStart < 0) {
    throw new Error("Rust export command is missing test module boundary");
  }
  return source.slice(start, testsStart);
}

describe("parseLatexFrontmatterConfig", () => {
  it("parses LaTeX export options from frontmatter", () => {
    const config = parseLatexFrontmatterConfig([
      "---",
      "bibliography: refs/project.bib",
      "latex:",
      "  template: lipics",
      "  bibliography: refs/paper.bib",
      "---",
      "",
      "# Paper",
    ].join("\n"));

    expect(config).toEqual({
      bibliography: "refs/project.bib",
      latex: {
        bibliography: "refs/paper.bib",
        template: "lipics",
      },
    });
  });

  it("ignores malformed or missing frontmatter", () => {
    expect(parseLatexFrontmatterConfig("# Paper")).toEqual({});
    expect(parseLatexFrontmatterConfig("---\n: bad yaml\n---\nBody")).toEqual({});
  });
});

describe("resolveLatexExportOptions", () => {
  it("defaults to the article template", () => {
    expect(resolveLatexExportOptions()).toEqual({
      bibliography: undefined,
      template: "article",
    });
  });

  it("prefers latex-specific bibliography over top-level bibliography", () => {
    expect(
      resolveLatexExportOptions({
        config: {
          bibliography: "refs/project.bib",
          latex: {
            bibliography: "refs/paper.bib",
            template: "lipics",
          },
        },
      }),
    ).toEqual({
      bibliography: "refs/paper.bib",
      template: "lipics",
    });
  });

  it("lets command-line flags override frontmatter", () => {
    expect(
      resolveLatexExportOptions({
        config: {
          bibliography: "refs/project.bib",
          latex: { template: "lipics" },
        },
        flags: {
          bibliography: "refs/cli.bib",
          template: "custom.tex",
        },
      }),
    ).toEqual({
      bibliography: "refs/cli.bib",
      template: "custom.tex",
    });
  });

  it("ignores non-string command-line flag sentinels", () => {
    expect(
      resolveLatexExportOptions({
        config: {
          bibliography: "refs/project.bib",
          latex: { template: "lipics" },
        },
        flags: {
          bibliography: true,
          template: true,
        },
      }),
    ).toEqual({
      bibliography: "refs/project.bib",
      template: "lipics",
    });
  });
});

describe("resolveLatexTemplatePath", () => {
  it("resolves built-in template names through the repo LaTeX directory", () => {
    const paths = [];
    const pathResolve = (base, path) => {
      paths.push([base, path]);
      return `${base}/${path}`;
    };

    expect(resolveLatexTemplatePath("article", { latexDir: "/repo/src/latex", pathResolve })).toBe(
      "/repo/src/latex/template/article.tex",
    );
    expect(resolveLatexTemplatePath("lipics", { latexDir: "/repo/src/latex", pathResolve })).toBe(
      "/repo/src/latex/template/lipics.tex",
    );
    expect(paths).toEqual([
      ["/repo/src/latex", "template/article.tex"],
      ["/repo/src/latex", "template/lipics.tex"],
    ]);
  });

  it("resolves custom template paths relative to the caller cwd", () => {
    const pathResolve = (base, path) => `${base}/${path}`;

    expect(
      resolveLatexTemplatePath("templates/custom.tex", {
        cwd: "/project",
        latexDir: "/repo/src/latex",
        pathResolve,
      }),
    ).toBe("/project/templates/custom.tex");
  });
});

describe("buildLatexPandocArgs", () => {
  it("builds the canonical LaTeX pandoc invocation", () => {
    expect(
      buildLatexPandocArgs({
        bibliography: "refs/project.bib",
        filterPath: "/repo/src/latex/filter.lua",
        output: "/project/out.tex",
        resourcePath: "/project/notes:/project",
        template: "/repo/src/latex/template/article.tex",
      }),
    ).toEqual([
      `--from=${LATEX_PANDOC_FROM}`,
      "--to=latex",
      "--wrap=preserve",
      "--syntax-highlighting=none",
      "--lua-filter=/repo/src/latex/filter.lua",
      "--template=/repo/src/latex/template/article.tex",
      "--resource-path=/project/notes:/project",
      "--output=/project/out.tex",
      "--metadata=bibliography=project",
    ]);
  });

  it("adds the PDF engine only for PDF export", () => {
    expect(
      buildLatexPandocArgs({
        filterPath: "/filter.lua",
        format: "pdf",
        output: "/project/out.pdf",
        template: "/template.tex",
      }),
    ).toContain("--pdf-engine=xelatex");

    expect(
      buildLatexPandocArgs({
        filterPath: "/filter.lua",
        format: "latex",
        output: "/project/out.tex",
        template: "/template.tex",
      }),
    ).not.toContain("--pdf-engine=xelatex");
  });
});

describe("Rust/JS LaTeX export profile sync", () => {
  it("keeps the duplicated native Pandoc profile aligned with the JS builder", () => {
    const rust = rustExportSource();
    const rustBuilder = extractRustBuildLatexPandocArgsBody(rust);
    const expectedProfileOrder = [
      "--from={}",
      "--to=latex",
      "--wrap=preserve",
      "--syntax-highlighting=none",
      "--lua-filter={}",
      "--template={}",
      "--resource-path={}",
      "--output={}",
    ];
    const jsProfileOrder = buildLatexPandocArgs({
      filterPath: "FILTER",
      output: "OUTPUT",
      resourcePath: "RESOURCE",
      template: "TEMPLATE",
    })
      .slice(0, expectedProfileOrder.length)
      .map((arg) =>
        arg
          .replace(/^--from=.*/, "--from={}")
          .replace(/^--lua-filter=.*/, "--lua-filter={}")
          .replace(/^--template=.*/, "--template={}")
          .replace(/^--resource-path=.*/, "--resource-path={}")
          .replace(/^--output=.*/, "--output={}")
      );

    expect(extractRustLatexPandocFrom(rust)).toBe(LATEX_PANDOC_FROM);
    expect(jsProfileOrder).toEqual(expectedProfileOrder);
    let previousRustIndex = -1;
    for (const profileArg of expectedProfileOrder) {
      const rustIndex = rustBuilder.indexOf(`"${profileArg}"`);
      expect(rustIndex).toBeGreaterThan(previousRustIndex);
      previousRustIndex = rustIndex;
    }
    for (const fixedArg of [
      "--to=latex",
      "--wrap=preserve",
      "--syntax-highlighting=none",
      "--pdf-engine=xelatex",
    ]) {
      expect(rustBuilder).toContain(`"${fixedArg}".to_string()`);
    }
    for (const dynamicFormat of [...expectedProfileOrder, "--metadata=bibliography={}"]) {
      expect(rustBuilder).toContain(`"${dynamicFormat}"`);
    }
  });
});

describe("latexBibliographyMetadataValue", () => {
  it("uses the bibliography basename without the .bib suffix", () => {
    expect(latexBibliographyMetadataValue("refs/project.bib")).toBe("project");
    expect(latexBibliographyMetadataValue("refs/project")).toBe("project");
  });
});
