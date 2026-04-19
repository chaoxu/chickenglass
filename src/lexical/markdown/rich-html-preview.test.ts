import katex from "katex";
import { describe, expect, it } from "vitest";

import { buildKatexOptions } from "../../lib/katex-options";
import {
  renderFrontmatterHtml,
  renderMarkdownInlineHtml,
  renderMarkdownRichHtml,
} from "./rich-html-preview";
import { buildRenderIndex, type RenderIndex } from "./reference-index";

const renderIndex: RenderIndex = {
  footnotes: new Map(),
  references: new Map([
    ["eq:sum", {
      kind: "equation",
      label: "Equation (1)",
      shortLabel: "(1)",
    }],
  ]),
};

describe("rich-html-preview", () => {
  it("renders frontmatter titles into preview chrome", () => {
    expect(renderFrontmatterHtml([
      "---",
      'title: "Preview Title"',
      "---",
      "",
      "Body",
    ].join("\n"))).toContain("Preview Title");
  });

  it("renders references and special markdown blocks through the preview boundary", () => {
    const html = renderMarkdownRichHtml([
      "See [@eq:sum].",
      "",
      "$$",
      "x + y",
      "$$ {#eq:sum}",
    ].join("\n"), {
      citations: {
        store: new Map(),
      },
      renderIndex,
      resolveAssetUrl: (targetPath) => targetPath,
    });

    expect(html).toContain("cf-lexical-reference");
    expect(html).toContain("cf-lexical-display-math-label");
    expect(html).toContain("(1)");
  });

  it("rewrites PDF image targets through resolveAssetUrl", () => {
    const html = renderMarkdownRichHtml("![Paper](figures/paper.pdf)", {
      citations: {
        store: new Map(),
      },
      renderIndex: {
        footnotes: new Map(),
        references: new Map(),
      },
      resolveAssetUrl: () => "/demo/notes/figures/paper.pdf",
    });

    expect(html).toContain("cf-lexical-media--pdf");
    expect(html).toContain("/demo/notes/figures/paper.pdf");
  });

  it("keeps asset resolution scoped to each render call", () => {
    const renderIndex = buildRenderIndex("");
    const markdown = "![Preview](figure.png)";

    const first = renderMarkdownRichHtml(markdown, {
      renderIndex,
      resolveAssetUrl: (targetPath) => `/preview-a/${targetPath}`,
    });
    const second = renderMarkdownRichHtml(markdown, {
      renderIndex,
      resolveAssetUrl: (targetPath) => `/preview-b/${targetPath}`,
    });

    expect(first).toContain('src="/preview-a/figure.png"');
    expect(second).toContain('src="/preview-b/figure.png"');
  });

  it("keeps math macros scoped to each render call", () => {
    const renderIndex = buildRenderIndex("");
    const markdown = "Inline $\\RR$ math";
    const bareMath = katex.renderToString("\\RR", buildKatexOptions(false));
    const configuredMath = katex.renderToString("\\RR", buildKatexOptions(false, {
      "\\RR": "\\mathbb{R}",
    }));

    const withoutMacros = renderMarkdownRichHtml(markdown, {
      renderIndex,
      resolveAssetUrl: () => null,
    });
    const withMacros = renderMarkdownRichHtml(markdown, {
      config: {
        math: {
          "\\RR": "\\mathbb{R}",
        },
      },
      renderIndex,
      resolveAssetUrl: () => null,
    });

    expect(bareMath).not.toBe(configuredMath);
    expect(withoutMacros).toContain(bareMath);
    expect(withoutMacros).not.toContain(configuredMath);
    expect(withMacros).toContain(configuredMath);
    expect(withMacros).not.toContain(bareMath);
  });

  it("renders inline math in inline markdown fragments", () => {
    const html = renderMarkdownInlineHtml("[1] A $k$-hitting set.", {
      renderIndex: buildRenderIndex(""),
      resolveAssetUrl: () => null,
    });

    expect(html).toContain("katex");
    expect(html).not.toContain("<p>");
  });

});
