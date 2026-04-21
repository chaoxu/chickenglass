import { describe, expect, it } from "vitest";

import {
  hoistMathMacros,
  liftFencedDivTitles,
  preprocess,
  promoteLabeledDisplayMath,
  renderMathMacros,
} from "./preprocess.mjs";

describe("liftFencedDivTitles", () => {
  it("hoists an inline title into a title attribute", () => {
    const input = "::: {#thm:main .theorem} Main result";
    const out = liftFencedDivTitles(input);
    expect(out).toBe('::: {#thm:main .theorem title="Main result"}');
  });

  it("leaves opener without trailing title untouched", () => {
    const input = "::: {#fig:demo .figure}";
    expect(liftFencedDivTitles(input)).toBe(input);
  });

  it("escapes double quotes in the title", () => {
    const input = '::: {.theorem} He said "hi"';
    expect(liftFencedDivTitles(input)).toBe('::: {.theorem title="He said \\"hi\\""}');
  });

  it("leaves non-opener lines alone", () => {
    const input = "regular paragraph\n:::\n";
    expect(liftFencedDivTitles(input)).toBe(input);
  });
});

describe("renderMathMacros", () => {
  it("detects arity by scanning for #N", () => {
    const out = renderMathMacros({ R: "\\mathbb{R}", floor: "\\lfloor #1 \\rfloor" });
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain("\\newcommand{\\floor}[1]{\\lfloor #1 \\rfloor}");
  });

  it("strips leading backslash from macro name", () => {
    const out = renderMathMacros({ "\\B": "\\mathcal{B}" });
    expect(out).toBe("\\newcommand{\\B}{\\mathcal{B}}");
  });
});

describe("hoistMathMacros", () => {
  it("moves math: into header-includes and preserves other keys", () => {
    const src = [
      "---",
      "title: Paper",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "  \\operatorname{cl}: \"\\\\operatorname{cl}\"",
      "---",
      "",
      "Body.",
    ].join("\n");
    const out = hoistMathMacros(src);
    expect(out).toContain("title: Paper");
    expect(out).not.toContain("math:\n");
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain("header-includes:");
    expect(out.split("---")[2]).toContain("Body.");
  });

  it("no-ops when no math frontmatter", () => {
    const src = "---\ntitle: X\n---\nBody\n";
    expect(hoistMathMacros(src)).toBe(src);
  });

  it("accepts closing delimiter whitespace", () => {
    const src = [
      "---",
      "title: Paper",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---   ",
      "",
      "Body.",
    ].join("\n");
    const out = hoistMathMacros(src);
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain("Body.");
  });
});

describe("promoteLabeledDisplayMath", () => {
  it("wraps a $$...$$ block with a trailing {#eq:id} into an equation env", () => {
    const src = "Before.\n\n$$\na + b = c\n$$ {#eq:sum}\n\nAfter.\n";
    const out = promoteLabeledDisplayMath(src);
    expect(out).toContain("\\begin{equation}\\label{eq:sum}");
    expect(out).toContain("a + b = c");
    expect(out).toContain("\\end{equation}");
    expect(out).not.toContain("$$");
  });

  it("leaves unlabeled $$...$$ blocks alone", () => {
    const src = "Before.\n\n$$\na = b\n$$\n\nAfter.\n";
    expect(promoteLabeledDisplayMath(src)).toBe(src);
  });

  it("handles two labeled blocks in sequence", () => {
    const src = "$$\nx\n$$ {#eq:a}\n\n$$\ny\n$$ {#eq:b}\n";
    const out = promoteLabeledDisplayMath(src);
    expect(out).toContain("\\label{eq:a}");
    expect(out).toContain("\\label{eq:b}");
  });

  it("does not promote display math when title text follows the label", () => {
    const src = "$$\nx\n$$ {#eq:a} Energy identity\n";
    expect(promoteLabeledDisplayMath(src)).toBe(src);
  });

  it("leaves canonical raw LaTeX labeled equations untouched", () => {
    const src = "\\begin{equation}\\label{eq:a}\nx\n\\end{equation}\n";
    expect(promoteLabeledDisplayMath(src)).toBe(src);
  });
});

describe("preprocess", () => {
  it("runs macro hoisting, equation promotion, and title lifting", async () => {
    const body = [
      "---",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---",
      "",
      "::: {#thm:x .theorem} Inside",
      "$$",
      "x \\in \\R",
      "$$ {#eq:x}",
      ":::",
    ].join("\n");
    const out = await preprocess(body, "main.md");
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain('::: {#thm:x .theorem title="Inside"}');
    expect(out).toContain("\\begin{equation}\\label{eq:x}");
  });
});
