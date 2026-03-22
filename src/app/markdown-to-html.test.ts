import { describe, it, expect, vi } from "vitest";
import { markdownToHtml, renderInline } from "./markdown-to-html";
import type { BibEntry } from "../citations/bibtex-parser";
import type { CslProcessor } from "../citations/csl-processor";

describe("renderInline", () => {
  it("renders plain text with HTML escaping", () => {
    expect(renderInline("Hello <world> & 'friends'")).toBe(
      'Hello &lt;world&gt; &amp; \'friends\'',
    );
  });

  it("renders bold text", () => {
    expect(renderInline("**bold**")).toBe("<strong>bold</strong>");
  });

  it("renders italic text", () => {
    expect(renderInline("*italic*")).toBe("<em>italic</em>");
  });

  it("renders inline code", () => {
    expect(renderInline("`code`")).toBe("<code>code</code>");
  });

  it("escapes HTML inside inline code", () => {
    expect(renderInline("`<div>`")).toBe("<code>&lt;div&gt;</code>");
  });

  it("renders strikethrough", () => {
    expect(renderInline("~~deleted~~")).toBe("<del>deleted</del>");
  });

  it("renders highlights", () => {
    expect(renderInline("==highlighted==")).toBe("<mark>highlighted</mark>");
  });

  it("renders inline math with $", () => {
    const result = renderInline("The formula $x^2$ is simple");
    expect(result).toContain("katex");
    expect(result).not.toContain("$");
  });

  it("renders inline math with \\(\\)", () => {
    const result = renderInline("The formula \\(x^2\\) is simple");
    expect(result).toContain("katex");
  });

  it("renders cross-references", () => {
    expect(renderInline("See [@thm-evt]")).toContain('class="cross-ref"');
    expect(renderInline("See [@thm-evt]")).toContain('href="#thm-evt"');
  });

  it("renders links", () => {
    expect(renderInline("[text](http://example.com)")).toBe(
      '<a href="http://example.com">text</a>',
    );
  });

  it("renders images", () => {
    expect(renderInline("![alt](image.png)")).toBe(
      '<img src="image.png" alt="alt">',
    );
  });

  it("renders inline footnote references", () => {
    expect(renderInline("Title[^1]")).toContain('class="footnote-ref"');
    expect(renderInline("Title[^1]")).toContain('href="#fn-1"');
  });
});

describe("markdownToHtml", () => {
  it("renders headings", () => {
    const html = markdownToHtml("# Heading 1\n## Heading 2\n### Heading 3");
    expect(html).toContain("<h1>Heading 1</h1>");
    expect(html).toContain("<h2>Heading 2</h2>");
    expect(html).toContain("<h3>Heading 3</h3>");
  });

  it("keeps hyphenated heading classes numbered in read mode", () => {
    const html = markdownToHtml("# Intro {.foo-bar}", { sectionNumbers: true });
    expect(html).toContain('<h1><span class="cg-section-number">1</span> Intro</h1>');
  });

  it("renders paragraphs", () => {
    const html = markdownToHtml("Hello world\n\nSecond paragraph");
    expect(html).toContain("<p>Hello world</p>");
    expect(html).toContain("<p>Second paragraph</p>");
  });

  it("renders unordered lists", () => {
    const html = markdownToHtml("- Item 1\n- Item 2\n- Item 3");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item 1</li>");
    expect(html).toContain("<li>Item 2</li>");
    expect(html).toContain("</ul>");
  });

  it("renders ordered lists", () => {
    const html = markdownToHtml("1. First\n2. Second\n3. Third");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
    expect(html).toContain("</ol>");
  });

  it("renders task lists", () => {
    const html = markdownToHtml("- [x] Done\n- [ ] Not done");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("Not done");
  });

  it("renders code blocks", () => {
    const html = markdownToHtml("```typescript\nconst x = 1;\n```");
    expect(html).toContain('<code class="language-typescript">');
    expect(html).toContain("const x = 1;");
    expect(html).toContain("</pre>");
  });

  it("renders > lines as paragraphs (blockquote parser removed)", () => {
    // Blockquotes are removed from the parser (removeBlockquote extension).
    // Documents use fenced div blockquotes (::: Blockquote) instead.
    const html = markdownToHtml("> This is a quote\n> Second line");
    expect(html).toContain("This is a quote");
    expect(html).toContain("Second line");
  });

  it("renders horizontal rules", () => {
    const html = markdownToHtml("---");
    expect(html).toContain("<hr>");
  });

  it("renders display math", () => {
    const html = markdownToHtml("$$\nx^2 + y^2 = z^2\n$$");
    expect(html).toContain('class="math-display"');
    expect(html).toContain("katex");
  });

  it("renders display math with equation labels", () => {
    const html = markdownToHtml("$$\nx^2\n$$ {#eq:foo}");
    expect(html).toContain('class="math-display"');
    expect(html).toContain("katex");
  });

  it("renders fenced divs with class", () => {
    const html = markdownToHtml("::: {.theorem #thm-1} Main Result\nContent here.\n:::");
    expect(html).toContain('class="theorem"');
    expect(html).toContain('id="thm-1"');
    expect(html).toContain("Main Result");
    expect(html).toContain("Content here.");
  });

  it("renders fenced divs with short form", () => {
    const html = markdownToHtml("::: Theorem\nContent.\n:::");
    expect(html).toContain('class="theorem"');
  });

  it("renders fenced div titles from title= attributes", () => {
    const html = markdownToHtml('::: {.problem title="**3SUM**"}\nBody.\n:::');
    expect(html).toContain("<strong>3SUM</strong>");
  });

  it("renders self-closing fenced divs", () => {
    const html = markdownToHtml("::: {.remark} The converse is false. :::");
    expect(html).toContain('class="remark"');
    expect(html).toContain("The converse is false.");
  });

  it("renders tables", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const html = markdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
  });

  it("renders table alignment", () => {
    const md = "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
    const html = markdownToHtml(md);
    expect(html).toContain('text-align: left');
    expect(html).toContain('text-align: center');
    expect(html).toContain('text-align: right');
  });

  it("skips YAML frontmatter", () => {
    const html = markdownToHtml("---\ntitle: Test\n---\n\n# Hello");
    expect(html).not.toContain("title: Test");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("skips include directives", () => {
    const html = markdownToHtml("::: {.include}\nchapters/intro.md\n:::");
    expect(html).not.toContain("chapters/intro.md");
    expect(html).not.toContain("include");
  });

  it("renders inline formatting inside blocks", () => {
    const html = markdownToHtml("# **Bold** heading\n\nA paragraph with *italic* and `code`.");
    expect(html).toContain("<h1><strong>Bold</strong> heading</h1>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders footnotes", () => {
    const html = markdownToHtml("[^1]: This is a footnote.");
    expect(html).toContain('class="footnote"');
    expect(html).toContain("This is a footnote.");
  });

  it("renders footnote references in headings and task items", () => {
    const html = markdownToHtml("# Title[^1]\n\n- [ ] Task[^1]\n\n[^1]: Note");
    expect(html).toContain('<h1>Title<sup><a class="footnote-ref" href="#fn-1">1</a></sup></h1>');
    expect(html).toContain('Task<sup><a class="footnote-ref" href="#fn-1">1</a></sup>');
  });

  it("renders nested content inside fenced divs", () => {
    const md = "::: {.theorem}\n\n# Inner Heading\n\nWith a paragraph.\n\n:::";
    const html = markdownToHtml(md);
    expect(html).toContain('class="theorem"');
    expect(html).toContain("<h1>Inner Heading</h1>");
    expect(html).toContain("<p>With a paragraph.</p>");
  });

  it("renders bibliography with rich-mode classes", () => {
    const entry: BibEntry = {
      id: "karger2000",
      type: "article",
      author: "David R. Karger",
      title: "Minimum Cuts in Near-Linear Time",
      journal: "Journal of the ACM",
      year: "2000",
    };
    const bibliography = new Map([[entry.id, entry]]);

    const html = markdownToHtml("See [@karger2000].", { bibliography });

    expect(html).toContain('class="cg-citation"');
    expect(html).toContain('class="cg-bibliography"');
    expect(html).toContain('class="cg-bibliography-heading"');
    expect(html).toContain('class="cg-bibliography-list"');
    expect(html).toContain('class="cg-bibliography-entry"');
    expect(html).not.toContain('class="bibliography"');
    expect(html).not.toContain('class="bib-entry"');
  });

  it("uses CSL formatting for read-mode citations and bibliography when provided", () => {
    const entry: BibEntry = {
      id: "karger2000",
      type: "article",
      author: "David R. Karger",
      title: "Minimum Cuts in Near-Linear Time",
      journal: "Journal of the ACM",
      year: "2000",
    };
    const bibliography = new Map([[entry.id, entry]]);
    const fakeCsl = {
      registerCitations: vi.fn(),
      cite: vi.fn(() => "[1]"),
      citeNarrative: vi.fn(() => "Karger [1]"),
      bibliography: vi.fn(() => ['<span class="csl-entry">[1] Karger.</span>']),
    } as unknown as CslProcessor;

    const html = markdownToHtml("See [@karger2000].", {
      bibliography,
      cslProcessor: fakeCsl,
    });

    expect(fakeCsl.registerCitations).toHaveBeenCalled();
    expect(fakeCsl.cite).toHaveBeenCalledWith(["karger2000"]);
    expect(fakeCsl.bibliography).toHaveBeenCalledWith(["karger2000"]);
    expect(html).toContain('<span class="cg-citation">[1]</span>');
    expect(html).toContain('<div class="cg-bibliography-entry" id="bib-karger2000"><span class="csl-entry">[1] Karger.</span></div>');
  });
});
