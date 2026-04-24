import { describe, expect, it } from "vitest";

import {
  buildLatexPandocArgs,
  buildHtmlPandocArgs,
  buildPandocResourcePath,
  exportDependencyTools,
  EXPORT_CONTRACT,
  LATEX_PANDOC_FROM,
  latexBibliographyMetadataValue,
  parseLatexFrontmatterConfig,
  resolveLatexExportOptions,
  resolveLatexTemplatePath,
} from "./export-options.mjs";

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

describe("shared export contract", () => {
  it("owns LaTeX, PDF, and HTML Pandoc profiles", () => {
    expect(LATEX_PANDOC_FROM).toBe(EXPORT_CONTRACT.pandoc_from);
    expect(EXPORT_CONTRACT.latex.args).toEqual([
      "--from={pandoc_from}",
      "--to=latex",
      "--wrap=preserve",
      "--syntax-highlighting=none",
      "--lua-filter={latex_filter_path}",
      "--template={latex_template_path}",
      "--resource-path={resource_path}",
      "--output={output_path}",
    ]);
    expect(EXPORT_CONTRACT.latex.pdf_args).toEqual(["--pdf-engine=xelatex"]);
    expect(EXPORT_CONTRACT.html.args).toContain("--filter=pandoc-crossref");
    expect(EXPORT_CONTRACT.html.args).toContain("--citeproc");
  });

  it("builds the canonical HTML Pandoc invocation", () => {
    expect(
      buildHtmlPandocArgs({
        output: "/project/out.html",
        resourcePath: "/project/notes:/project",
      }),
    ).toEqual([
      `--from=${LATEX_PANDOC_FROM}`,
      "--to=html5",
      "--standalone",
      "--wrap=preserve",
      "--katex",
      "--section-divs",
      "--filter=pandoc-crossref",
      "--citeproc",
      "--metadata=link-citations=true",
      "--resource-path=/project/notes:/project",
      "--output=/project/out.html",
    ]);
  });

  it("centralizes resource-path order and dependency tools", () => {
    expect(buildPandocResourcePath("/project", "/project/notes")).toBe(
      "/project/notes:/project",
    );
    expect(buildPandocResourcePath("/project", "/project")).toBe("/project");
    expect(exportDependencyTools("html").map((tool) => tool.name)).toEqual([
      "pandoc",
      "pandoc-crossref",
    ]);
    expect(exportDependencyTools("pdf").map((tool) => tool.name)).toEqual([
      "pandoc",
      "xelatex",
    ]);
  });
});

describe("latexBibliographyMetadataValue", () => {
  it("uses the bibliography basename without the .bib suffix", () => {
    expect(latexBibliographyMetadataValue("refs/project.bib")).toBe("project");
    expect(latexBibliographyMetadataValue("refs/project")).toBe("project");
  });
});
