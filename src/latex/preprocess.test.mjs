import { describe, expect, it } from "vitest";

import {
  hoistMathMacros,
  preprocess,
  renderMathMacros,
} from "./preprocess.mjs";

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

describe("preprocess", () => {
  it("only applies canonical pre-pandoc transforms", async () => {
    const src = [
      "---",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---",
      "",
      '::: {.theorem #thm:x title="Canonical"}',
      "Body.",
      ":::",
      "",
      "\\begin{equation}\\label{eq:x}",
      "x \\in \\R",
      "\\end{equation}",
    ].join("\n");

    const out = await preprocess(src, "main.md");

    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain('::: {.theorem #thm:x title="Canonical"}');
    expect(out).toContain("\\begin{equation}\\label{eq:x}");
  });
});
