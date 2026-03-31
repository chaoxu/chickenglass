import { describe, it, expect, vi } from "vitest";
import { markdownToHtml, renderInline, type BlockCounterEntry } from "./markdown-to-html";
import type { CslJsonItem } from "../citations/bibtex-parser";
import type { CslProcessor } from "../citations/csl-processor";
import { CSS } from "../constants/css-classes";

describe("renderInline", () => {
  it("renders plain text with HTML escaping", () => {
    expect(renderInline("Hello <world> & 'friends'")).toBe(
      'Hello &lt;world&gt; &amp; \'friends\'',
    );
  });

  it("renders bold text", () => {
    expect(renderInline("**bold**")).toBe(`<strong class="${CSS.bold}">bold</strong>`);
  });

  it("renders italic text", () => {
    expect(renderInline("*italic*")).toBe(`<em class="${CSS.italic}">italic</em>`);
  });

  it("renders inline code", () => {
    expect(renderInline("`code`")).toBe(`<code class="${CSS.inlineCode}">code</code>`);
  });

  it("escapes HTML inside inline code", () => {
    expect(renderInline("`<div>`")).toBe(`<code class="${CSS.inlineCode}">&lt;div&gt;</code>`);
  });

  it("renders strikethrough", () => {
    expect(renderInline("~~deleted~~")).toBe(`<del class="${CSS.strikethrough}">deleted</del>`);
  });

  it("renders highlights", () => {
    expect(renderInline("==highlighted==")).toBe(`<mark class="${CSS.highlight}">highlighted</mark>`);
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

  it("degrades links to inert text in ui-chrome-inline", () => {
    expect(renderInline("[text](http://example.com)", undefined, "ui-chrome-inline")).toBe(
      "text",
    );
  });

  it("degrades cross references to inert text in ui-chrome-inline", () => {
    expect(renderInline("See [@thm-evt]", undefined, "ui-chrome-inline")).toBe(
      "See @thm-evt",
    );
  });

  it("degrades footnote references to inert superscripts in ui-chrome-inline", () => {
    expect(renderInline("Title[^1]", undefined, "ui-chrome-inline")).toBe("Title<sup>1</sup>");
  });

  it("degrades images to alt text in document-inline", () => {
    expect(renderInline("![alt](image.png)", undefined, "document-inline")).toBe("alt");
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
    expect(html).toContain(`<h1><span class="${CSS.sectionNumber}">1</span> Intro</h1>`);
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

  it("renders blockquotes as <blockquote> HTML", () => {
    // Regression (#399): the HTML renderer must parse standard `>` blockquote
    // syntax into Blockquote nodes. The editor parser strips blockquotes
    // (removeBlockquote) since it uses fenced divs, but the HTML export /
    // hover preview path must handle `>` syntax from content.
    const html = markdownToHtml("> This is a quote\n> Second line");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("</blockquote>");
    expect(html).toContain("This is a quote");
    expect(html).toContain("Second line");
  });

  it("renders nested blockquotes", () => {
    const html = markdownToHtml("> Outer\n> > Inner");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("Outer");
    expect(html).toContain("Inner");
  });

  it("renders horizontal rules", () => {
    const html = markdownToHtml("---");
    expect(html).toContain("<hr>");
  });

  it("renders display math", () => {
    const html = markdownToHtml("$$\nx^2 + y^2 = z^2\n$$");
    expect(html).toContain(`class="${CSS.mathDisplay}"`);
    expect(html).toContain("katex");
  });

  it("renders display math with equation labels", () => {
    const html = markdownToHtml("$$\nx^2\n$$ {#eq:foo}");
    expect(html).toContain(`class="${CSS.mathDisplay}"`);
    expect(html).toContain("katex");
  });

  it("renders fenced divs with class", () => {
    const html = markdownToHtml("::: {.theorem #thm-1} Main Result\nContent here.\n:::");
    expect(html).toContain(`class="${CSS.block("theorem")}"`);
    expect(html).toContain('id="thm-1"');
    expect(html).toContain("Main Result");
    expect(html).toContain("Content here.");
  });

  it("renders fenced divs with short form", () => {
    const html = markdownToHtml("::: Theorem\nContent.\n:::");
    expect(html).toContain(`class="${CSS.block("theorem")}"`);
  });

  it("renders fenced div titles from title= attributes", () => {
    const html = markdownToHtml('::: {.problem title="**3SUM**"}\nBody.\n:::');
    expect(html).toContain(`<strong class="${CSS.bold}">3SUM</strong>`);
  });

  it("renders self-closing fenced divs", () => {
    const html = markdownToHtml("::: {.remark} The converse is false. :::");
    expect(html).toContain(`class="${CSS.block("remark")}"`);
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
    expect(html).toContain(`<h1><strong class="${CSS.bold}">Bold</strong> heading</h1>`);
    expect(html).toContain(`<em class="${CSS.italic}">italic</em>`);
    expect(html).toContain(`<code class="${CSS.inlineCode}">code</code>`);
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
    expect(html).toContain(`class="${CSS.block("theorem")}"`);
    expect(html).toContain("<h1>Inner Heading</h1>");
    expect(html).toContain("<p>With a paragraph.</p>");
  });

  it("uses prepared overrides for relative file-backed image targets", () => {
    const html = markdownToHtml("![Figure](fig.pdf)\n\n![Photo](photo.png)", {
      documentPath: "notes/main.md",
      imageUrlOverrides: new Map([
        ["notes/fig.pdf", "data:image/png;base64,PDFPAGE1"],
        ["notes/photo.png", "data:image/png;base64,PHOTO1"],
      ]),
    });

    expect(html).toContain('<img src="data:image/png;base64,PDFPAGE1" alt="Figure">');
    expect(html).toContain('<img src="data:image/png;base64,PHOTO1" alt="Photo">');
    expect(html).not.toContain('<img src="fig.pdf" alt="Figure">');
    expect(html).not.toContain('<img src="photo.png" alt="Photo">');
  });

  it("renders bibliography with rich-mode classes", () => {
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      "container-title": "Journal of the ACM",
      issued: { "date-parts": [[2000]] },
    };
    const bibliography = new Map([[entry.id, entry]]);

    const html = markdownToHtml("See [@karger2000].", { bibliography });

    expect(html).toContain(`class="${CSS.citation}"`);
    expect(html).toContain(`class="${CSS.bibliography}"`);
    expect(html).toContain(`class="${CSS.bibliographyHeading}"`);
    expect(html).toContain(`class="${CSS.bibliographyList}"`);
    expect(html).toContain(`class="${CSS.bibliographyEntry}"`);
    expect(html).not.toContain('class="bibliography"');
    expect(html).not.toContain('class="bib-entry"');
  });

  it("uses CSL formatting for read-mode citations and bibliography when provided", () => {
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      "container-title": "Journal of the ACM",
      issued: { "date-parts": [[2000]] },
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
    expect(html).toContain(`<span class="${CSS.citation}">[1]</span>`);
    expect(html).toContain(`<div class="${CSS.bibliographyEntry}" id="bib-karger2000"><span class="csl-entry">[1] Karger.</span></div>`);
  });

  // Regression (#482): CSL bibliography HTML must be sanitized before
  // interpolation into the HTML export. A malicious BibTeX entry could
  // inject <script> or event handlers via CSL output.
  it("sanitizes malicious CSL bibliography HTML in export output", () => {
    const entry: CslJsonItem = {
      id: "evil2024",
      type: "article-journal",
      author: [{ family: "Evil", given: "Author" }],
      title: "XSS Attack",
      issued: { "date-parts": [[2024]] },
    };
    const bibliography = new Map([[entry.id, entry]]);
    const fakeCsl = {
      registerCitations: vi.fn(),
      cite: vi.fn(() => "[1]"),
      citeNarrative: vi.fn(() => "Evil [1]"),
      bibliography: vi.fn(() => [
        '<span class="csl-entry">[1] Evil.<script>alert("xss")</script></span>',
      ]),
    } as unknown as CslProcessor;

    const html = markdownToHtml("See [@evil2024].", {
      bibliography,
      cslProcessor: fakeCsl,
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain(`class="${CSS.bibliographyEntry}"`);
  });

  it("uses CSL formatting for narrative citations in read mode", () => {
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      issued: { "date-parts": [[2000]] },
    };
    const bibliography = new Map([[entry.id, entry]]);
    const fakeCsl = {
      registerCitations: vi.fn(),
      cite: vi.fn(() => "[1]"),
      citeNarrative: vi.fn(() => "Karger [1]"),
      bibliography: vi.fn(() => ['<span class="csl-entry">[1] Karger.</span>']),
    } as unknown as CslProcessor;

    const html = markdownToHtml("As @karger2000 showed.", {
      bibliography,
      cslProcessor: fakeCsl,
    });

    expect(fakeCsl.citeNarrative).toHaveBeenCalledWith("karger2000");
    expect(html).toContain(`<span class="${CSS.citationNarrative}">Karger [1]</span>`);
  });

  // Regression: clustered equation references like [@eq:a; @eq:b] should
  // resolve each label (e.g. "Eq. (1)") instead of showing raw ids. (#335)
  it("renders clustered equation crossrefs with resolved labels", () => {
    const doc = [
      "$$a^2$$ {#eq:gaussian}",
      "",
      "$$b^2$$ {#eq:binomial}",
      "",
      "See [@eq:gaussian; @eq:binomial].",
    ].join("\n");
    const html = markdownToHtml(doc);

    expect(html).toContain('href="#eq:gaussian"');
    expect(html).toContain("Eq. (1)");
    expect(html).toContain('href="#eq:binomial"');
    expect(html).toContain("Eq. (2)");
  });

  it("renders single equation crossref with resolved label", () => {
    const doc = [
      "$$a^2$$ {#eq:energy}",
      "",
      "See [@eq:energy].",
    ].join("\n");
    const html = markdownToHtml(doc);

    expect(html).toContain('href="#eq:energy"');
    expect(html).toContain("Eq. (1)");
  });

  // Regression (#358): mixed crossref+citation clusters like [@eq:foo; @smith2020]
  // must resolve crossref ids as labels and citation ids via CSL, not send all to CSL.
  it("renders mixed crossref+citation cluster with both resolved", () => {
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      issued: { "date-parts": [[2000]] },
    };
    const bibliography = new Map([[entry.id, entry]]);
    const fakeCsl = {
      registerCitations: vi.fn(),
      cite: vi.fn(() => "[1]"),
      citeNarrative: vi.fn(() => "Karger [1]"),
      bibliography: vi.fn(() => ['<span class="csl-entry">[1] Karger.</span>']),
    } as unknown as CslProcessor;

    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    const html = markdownToHtml(doc, { bibliography, cslProcessor: fakeCsl });

    // The crossref part should be an anchor with resolved label
    expect(html).toContain('class="cross-ref"');
    expect(html).toContain('href="#eq:alpha"');
    expect(html).toContain("Eq. (1)");
    // The citation part should be formatted via CSL
    expect(fakeCsl.cite).toHaveBeenCalled();
    // Both parts combined in a citation span
    expect(html).toContain(`class="${CSS.citation}"`);
  });

  it("pure citation cluster still goes through CSL without splitting", () => {
    const entry: CslJsonItem = {
      id: "karger2000",
      type: "article-journal",
      author: [{ family: "Karger", given: "David R." }],
      title: "Minimum Cuts in Near-Linear Time",
      issued: { "date-parts": [[2000]] },
    };
    const entry2: CslJsonItem = {
      id: "stein2001",
      type: "book",
      author: [{ family: "Stein", given: "Clifford" }],
      title: "Algorithms",
      issued: { "date-parts": [[2001]] },
    };
    const bibliography = new Map([
      [entry.id, entry],
      [entry2.id, entry2],
    ]);
    const fakeCsl = {
      registerCitations: vi.fn(),
      cite: vi.fn(() => "[1, 2]"),
      citeNarrative: vi.fn(() => ""),
      bibliography: vi.fn(() => []),
    } as unknown as CslProcessor;

    const html = markdownToHtml("See [@karger2000; @stein2001].", {
      bibliography,
      cslProcessor: fakeCsl,
    });

    // Pure citation cluster should call cite with both ids as a single cluster
    expect(fakeCsl.cite).toHaveBeenCalledWith(
      ["karger2000", "stein2001"],
    );
    expect(html).toContain(`class="${CSS.citation}"`);
    // Should NOT contain cross-ref anchors
    expect(html).not.toContain('class="cross-ref"');
  });

  it("pure crossref cluster renders without citation formatting", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    const html = markdownToHtml(doc);

    expect(html).toContain('class="cross-ref"');
    expect(html).toContain("Eq. (1)");
    expect(html).toContain("Eq. (2)");
    // Should NOT contain cf-citation class
    expect(html).not.toContain(`class="${CSS.citation}"`);
  });

  // Regression (#399): block counter entries must resolve crossrefs like
  // [@thm-1] to "Theorem 1" in hover preview bodies, which call
  // markdownToHtml with blockCounters but without CM6 state.
  it("resolves block counter crossrefs with blockCounters option", () => {
    const blockCounters = new Map<string, BlockCounterEntry>([
      ["thm-1", { type: "theorem", title: "Theorem", number: 1 }],
      ["lem-2", { type: "lemma", title: "Lemma", number: 2 }],
    ]);

    const doc = "See [@thm-1] and [@lem-2].";
    const html = markdownToHtml(doc, { blockCounters });

    expect(html).toContain('href="#thm-1"');
    expect(html).toContain("Theorem 1");
    expect(html).toContain('href="#lem-2"');
    expect(html).toContain("Lemma 2");
  });

  // Regression (#399): block counter crossrefs in mixed clusters with
  // citations must resolve the block refs as labels while citations go
  // through CSL.
  it("resolves mixed block-counter + citation clusters", () => {
    const blockCounters = new Map<string, BlockCounterEntry>([
      ["thm-main", { type: "theorem", title: "Theorem", number: 3 }],
    ]);
    const entry: CslJsonItem = {
      id: "cormen2009",
      type: "book",
      author: [{ family: "Cormen", given: "Thomas H." }],
      title: "Introduction to Algorithms",
      issued: { "date-parts": [[2009]] },
    };
    const bibliography = new Map([[entry.id, entry]]);
    const fakeCsl = {
      registerCitations: vi.fn(),
      cite: vi.fn(() => "[1]"),
      citeNarrative: vi.fn(() => "Cormen [1]"),
      bibliography: vi.fn(() => []),
    } as unknown as CslProcessor;

    const doc = "See [@thm-main; @cormen2009].";
    const html = markdownToHtml(doc, { bibliography, cslProcessor: fakeCsl, blockCounters });

    // Block ref should resolve to "Theorem 3"
    expect(html).toContain('href="#thm-main"');
    expect(html).toContain("Theorem 3");
    // Citation part should go through CSL
    expect(fakeCsl.cite).toHaveBeenCalled();
    expect(html).toContain(`class="${CSS.citation}"`);
  });

  // Regression (#399): blockCounters takes priority over equation semantics
  // when both are present (unlikely but verifies resolution order).
  it("block counter takes priority over equation label for same id", () => {
    const blockCounters = new Map<string, BlockCounterEntry>([
      ["eq:special", { type: "theorem", title: "Result", number: 7 }],
    ]);

    const doc = "See [@eq:special].";
    const html = markdownToHtml(doc, { blockCounters });

    // Should use the block counter entry, not fall through to equation resolution
    expect(html).toContain("Result 7");
  });

  it("resolves heading crossrefs to section labels", () => {
    const doc = [
      "# Intro",
      "",
      "## Background {#sec:background}",
      "",
      "See [@sec:background].",
    ].join("\n");
    const html = markdownToHtml(doc, { sectionNumbers: true });

    expect(html).toContain('href="#sec:background"');
    expect(html).toContain("Section 1.1");
  });

  // Regression (#399): existing non-citation, non-block content renders correctly
  // when blockCounters is provided (no interference).
  it("non-crossref content renders normally with blockCounters option", () => {
    const blockCounters = new Map<string, BlockCounterEntry>([
      ["thm-1", { type: "theorem", title: "Theorem", number: 1 }],
    ]);

    const html = markdownToHtml("**Bold** and *italic* and `code`.", { blockCounters });
    expect(html).toContain(`<strong class="${CSS.bold}">Bold</strong>`);
    expect(html).toContain(`<em class="${CSS.italic}">italic</em>`);
    expect(html).toContain(`<code class="${CSS.inlineCode}">code</code>`);
  });
});
