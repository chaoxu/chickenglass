import { describe, it, expect } from "vitest";
import type { InlineRenderSurface } from "../inline-surface";
import { renderInlineMarkdown, splitByInlineMath } from "./inline-render";

/** Render inline markdown into a div and return innerHTML. */
function render(
  text: string,
  macros: Record<string, string> = {},
  surface: InlineRenderSurface | "document-body" = "document-body",
): string {
  const container = document.createElement("div");
  renderInlineMarkdown(container, text, macros, surface);
  return container.innerHTML;
}

describe("splitByInlineMath", () => {
  it("returns a single text segment for plain text", () => {
    const segments = splitByInlineMath("hello world");
    expect(segments).toEqual([{ isMath: false, content: "hello world" }]);
  });

  it("returns a single math segment for pure math", () => {
    const segments = splitByInlineMath("$x^2$");
    expect(segments).toEqual([{ isMath: true, content: "x^2" }]);
  });

  it("strips dollar delimiters from math content", () => {
    const segments = splitByInlineMath("$\\alpha$");
    expect(segments[0].isMath).toBe(true);
    expect(segments[0].content).toBe("\\alpha");
  });

  it("returns empty array for empty string", () => {
    const segments = splitByInlineMath("");
    expect(segments).toEqual([]);
  });

  it("splits text + math + text correctly", () => {
    const segments = splitByInlineMath("before $x$ after");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ isMath: false, content: "before " });
    expect(segments[1]).toEqual({ isMath: true, content: "x" });
    expect(segments[2]).toEqual({ isMath: false, content: " after" });
  });

  it("splits multiple math segments", () => {
    const segments = splitByInlineMath("$a$ and $b$");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ isMath: true, content: "a" });
    expect(segments[1]).toEqual({ isMath: false, content: " and " });
    expect(segments[2]).toEqual({ isMath: true, content: "b" });
  });

  it("handles math at the start", () => {
    const segments = splitByInlineMath("$x$ text");
    expect(segments[0]).toEqual({ isMath: true, content: "x" });
    expect(segments[1]).toEqual({ isMath: false, content: " text" });
  });

  it("handles math at the end", () => {
    const segments = splitByInlineMath("text $x$");
    expect(segments[0]).toEqual({ isMath: false, content: "text " });
    expect(segments[1]).toEqual({ isMath: true, content: "x" });
  });

  it("marks isMath false for non-math segments", () => {
    const segments = splitByInlineMath("hello");
    expect(segments.every((s) => s.isMath === false)).toBe(true);
  });
});

describe("renderInlineMarkdown — plain text", () => {
  it("renders plain text as a text node", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "hello");
    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(container.textContent).toBe("hello");
  });

  it("renders empty string without adding nodes", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "");
    expect(container.childNodes).toHaveLength(0);
  });

  it("appends to existing container content", () => {
    const container = document.createElement("div");
    container.textContent = "existing";
    renderInlineMarkdown(container, " appended");
    expect(container.textContent).toBe("existing appended");
  });
});

describe("renderInlineMarkdown — bold", () => {
  it("renders **text** as <strong>", () => {
    const html = render("**bold**");
    expect(html).toBe("<strong>bold</strong>");
  });

  it("renders text before bold correctly", () => {
    const html = render("before **bold**");
    expect(html).toContain("before ");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders text after bold correctly", () => {
    const html = render("**bold** after");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain(" after");
  });

  it("renders bold in the middle of text", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "a **b** c");
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("b");
    expect(container.textContent).toBe("a b c");
  });

  it("renders multiple bold segments", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "**a** and **b**");
    const strongs = container.querySelectorAll("strong");
    expect(strongs).toHaveLength(2);
    expect(strongs[0].textContent).toBe("a");
    expect(strongs[1].textContent).toBe("b");
  });
});

describe("renderInlineMarkdown — italic", () => {
  it("renders *text* as <em>", () => {
    const html = render("*italic*");
    expect(html).toBe("<em>italic</em>");
  });

  it("renders text before italic correctly", () => {
    const html = render("before *italic*");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("before ");
  });

  it("renders italic in the middle of text", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "a *b* c");
    const em = container.querySelector("em");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("b");
    expect(container.textContent).toBe("a b c");
  });

  it("renders multiple italic segments", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "*a* and *b*");
    const ems = container.querySelectorAll("em");
    expect(ems).toHaveLength(2);
    expect(ems[0].textContent).toBe("a");
    expect(ems[1].textContent).toBe("b");
  });
});

describe("renderInlineMarkdown — inline math", () => {
  it("renders $math$ as a <span> containing KaTeX output", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "$x^2$");
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    // KaTeX output contains a .katex element
    expect(span?.querySelector(".katex")).not.toBeNull();
  });

  it("does not include dollar delimiters in rendered output text", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "$x$");
    // The math span should not contain literal dollar signs
    expect(container.querySelector("span")?.textContent).not.toContain("$");
  });

  it("renders invalid LaTeX as fallback text with dollar signs", () => {
    const container = document.createElement("div");
    // KaTeX with throwOnError: false handles errors gracefully; test doesn't throw
    expect(() => renderInlineMarkdown(container, "$\\frac{$")).not.toThrow();
  });

  it("uses macros when rendering math", () => {
    const macros = { "\\RR": "\\mathbb{R}" };
    const container = document.createElement("div");
    renderInlineMarkdown(container, "$\\RR$", macros);
    // Should render without throwing, producing a span
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
  });

  it("renders text before and after math", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "Let $x$ be");
    expect(container.textContent).toContain("Let");
    expect(container.textContent).toContain("be");
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});

describe("renderInlineMarkdown — mixed content", () => {
  it("renders bold and italic together", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "**bold** and *italic*");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders math alongside bold text", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "**Theorem** $x^2 = y$");
    expect(container.querySelector("strong")?.textContent).toBe("Theorem");
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("renders multiple math expressions with surrounding text", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "$a$ plus $b$ equals $c$");
    // Each math expression gets its own direct-child span wrapper
    const directSpans = Array.from(container.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === "SPAN",
    );
    expect(directSpans).toHaveLength(3);
  });

  it("preserves text between math expressions", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "$a$ and $b$");
    expect(container.textContent).toContain("and");
  });
});

describe("renderInlineMarkdown — strikethrough", () => {
  it("renders ~~text~~ as <del>", () => {
    const html = render("~~deleted~~");
    expect(html).toContain("<del>");
    expect(html).toContain("deleted");
  });
});

describe("renderInlineMarkdown — highlight", () => {
  it("renders ==text== as <mark>", () => {
    const html = render("==highlighted==");
    expect(html).toContain("<mark>");
    expect(html).toContain("highlighted");
  });
});

describe("renderInlineMarkdown — inline code", () => {
  it("renders `code` as <code>", () => {
    const html = render("`code`");
    expect(html).toContain("<code>");
    expect(html).toContain("code");
  });
});

describe("renderInlineMarkdown — nested emphasis", () => {
  it("renders bold nested inside italic", () => {
    const html = render("*text with **bold** inside*");
    expect(html).toContain("<em>");
    expect(html).toContain("<strong>");
  });

  it("renders bold inside parentheses (issue #260 scenario)", () => {
    const html = render("Theorem 1 (**3SUM**)");
    expect(html).toContain("<strong>");
    expect(html).toContain("3SUM");
  });
});

describe("renderInlineMarkdown — escape sequences", () => {
  it("does not render escaped asterisks as italic", () => {
    const html = render("\\*not italic\\*");
    expect(html).not.toContain("<em>");
    expect(html).toContain("*not italic*");
  });
});

describe("renderInlineMarkdown — surface policies", () => {
  it("renders links as anchors in document-inline", () => {
    const html = render("[text](https://example.com)", {}, "document-inline");
    expect(html).toBe('<a href="https://example.com">text</a>');
  });

  it("degrades links to inert text in ui-chrome-inline", () => {
    const html = render("[text](https://example.com)", {}, "ui-chrome-inline");
    expect(html).toBe("text");
  });

  it("degrades images to alt text in document-inline", () => {
    const html = render("![alt text](image.png)", {}, "document-inline");
    expect(html).toBe("alt text");
  });

  it("renders body images as img elements in document-body", () => {
    const html = render("![alt text](image.png)");
    expect(html).toBe('<img src="image.png" alt="alt text">');
  });

  it("renders footnote refs as inert superscripts in ui-chrome-inline", () => {
    const html = render("Title[^1]", {}, "ui-chrome-inline");
    expect(html).toBe("Title<sup>1</sup>");
  });

  it("renders cross references as inert text in ui-chrome-inline", () => {
    const html = render("See [@thm-evt]", {}, "ui-chrome-inline");
    expect(html).toBe("See @thm-evt");
  });

  it("keeps narrative references inert in document-inline without bibliography context", () => {
    const html = render("As @karger2000 showed.", {}, "document-inline");
    expect(html).toBe("As @karger2000 showed.");
  });
});
