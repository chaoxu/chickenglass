import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hoistMathMacros,
  liftFencedDivTitles,
  preprocess,
  promoteLabeledDisplayMath,
  renderMathMacros,
  resolveIncludes,
  stripFrontmatter,
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

describe("resolveIncludes", () => {
  it("splices an included file's body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coflat-latex-"));
    const main = join(dir, "main.md");
    const chapter = join(dir, "chapter.md");
    await writeFile(chapter, "# Chapter\n\nBody.\n");
    const body = "Before.\n\n::: {.include}\nchapter.md\n:::\n\nAfter.\n";
    await writeFile(main, body);
    const out = await resolveIncludes(body, main);
    expect(out).toContain("# Chapter");
    expect(out).toContain("Body.");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
    expect(out).not.toContain("::: {.include}");
  });

  it("strips frontmatter from the included file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coflat-latex-"));
    const main = join(dir, "main.md");
    const chapter = join(dir, "chapter.md");
    await writeFile(chapter, "---\ntitle: Chapter\n---\n\n# Chapter\n");
    const body = "::: {.include}\nchapter.md\n:::\n";
    await writeFile(main, body);
    const out = await resolveIncludes(body, main);
    expect(out).not.toContain("title: Chapter");
    expect(out).toContain("# Chapter");
  });

  it("rejects include cycles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coflat-latex-"));
    const a = join(dir, "a.md");
    const b = join(dir, "b.md");
    await writeFile(a, "::: {.include}\nb.md\n:::\n");
    await writeFile(b, "::: {.include}\na.md\n:::\n");
    const aBody = "::: {.include}\nb.md\n:::\n";
    await expect(resolveIncludes(aBody, a)).rejects.toThrow(/cycle/i);
  });
});

describe("stripFrontmatter", () => {
  it("strips frontmatter with closing delimiter whitespace", () => {
    expect(stripFrontmatter("---\ntitle: Chapter\n---   \n\n# Chapter\n")).toBe("\n# Chapter\n");
  });

  it("leaves documents without opening frontmatter unchanged", () => {
    const source = "Body.\n\n---\ntitle: Not frontmatter\n---\n";
    expect(stripFrontmatter(source)).toBe(source);
  });

  it("leaves delimiter-like body lines untouched", () => {
    const source = "# Chapter\n\n---\nNot frontmatter.\n";
    expect(stripFrontmatter(source)).toBe(source);
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
});

describe("preprocess", () => {
  it("composes includes then title lifting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coflat-latex-"));
    const main = join(dir, "main.md");
    const chapter = join(dir, "chapter.md");
    await writeFile(chapter, "::: {#thm:x .theorem} Inside\nBody.\n:::\n");
    const body = "::: {.include}\nchapter.md\n:::\n";
    await writeFile(main, body);
    const out = await preprocess(body, main);
    expect(out).toContain('::: {#thm:x .theorem title="Inside"}');
  });
});
