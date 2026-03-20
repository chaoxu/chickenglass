import { describe, it, expect } from "vitest";
import { markdownToHtml, renderInline } from "./markdown-to-html";

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
});

describe("markdownToHtml", () => {
  it("renders headings", () => {
    const html = markdownToHtml("# Heading 1\n## Heading 2\n### Heading 3");
    expect(html).toContain("<h1>Heading 1</h1>");
    expect(html).toContain("<h2>Heading 2</h2>");
    expect(html).toContain("<h3>Heading 3</h3>");
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

  it("renders nested content inside fenced divs", () => {
    const md = "::: {.theorem}\n\n# Inner Heading\n\nWith a paragraph.\n\n:::";
    const html = markdownToHtml(md);
    expect(html).toContain('class="theorem"');
    expect(html).toContain("<h1>Inner Heading</h1>");
    expect(html).toContain("<p>With a paragraph.</p>");
  });
});
