import { describe, expect, it } from "vitest";

import { renderFrontmatterHtml, renderMarkdownRichHtml } from "./rich-html-preview";
import type { RenderIndex } from "./reference-index";

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
});
