import { describe, expect, it, afterEach } from "vitest";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { frontmatterField } from "../editor/frontmatter-state";
import { projectConfigFacet } from "../app/project-config";
import { getMathMacros, mathMacrosField } from "./math-macros";
import { collectMathRanges } from "./math-render";
import { MathWidget } from "./math-widget";
import { createTestView } from "../test-utils";
import { documentSemanticsField } from "../state/document-analysis";

/** Create an EditorView with frontmatter and math parser extensions. */
function createView(
  doc: string,
  cursorPos?: number,
  projectConfig?: Record<string, string>,
): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension] }),
      ...(projectConfig ? [projectConfigFacet.of({ math: projectConfig })] : []),
      frontmatterField,
      documentSemanticsField,
      mathMacrosField,
    ],
  });
}

describe("getMathMacros", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("returns macros from frontmatter", () => {
    const doc = "---\nmath:\n  \\R: \\mathbb{R}\n  \\N: \\mathbb{N}\n---\nContent";
    view = createView(doc);
    const macros = getMathMacros(view.state);
    expect(macros).toEqual({
      "\\R": "\\mathbb{R}",
      "\\N": "\\mathbb{N}",
    });
  });

  it("returns empty record when no frontmatter", () => {
    view = createView("Just plain text");
    const macros = getMathMacros(view.state);
    expect(macros).toEqual({});
  });

  it("returns empty record when frontmatter has no math field", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    view = createView(doc);
    const macros = getMathMacros(view.state);
    expect(macros).toEqual({});
  });

  it("returns empty record when math field is empty", () => {
    const doc = "---\nmath:\n---\nContent";
    view = createView(doc);
    const macros = getMathMacros(view.state);
    expect(macros).toEqual({});
  });
});

describe("getMathMacros with project config", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("returns project macros when file has no math frontmatter", () => {
    const doc = "---\ntitle: Test\n---\nContent";
    view = createView(doc, undefined, {
      "\\R": "\\mathbb{R}",
      "\\e": "\\varepsilon",
    });

    const macros = getMathMacros(view.state);
    expect(macros).toEqual({
      "\\R": "\\mathbb{R}",
      "\\e": "\\varepsilon",
    });
  });

  it("merges project and file macros (file overrides)", () => {
    const doc = "---\nmath:\n  \\R: \\mathcal{R}\n  \\Z: \\mathbb{Z}\n---\nContent";
    view = createView(doc, undefined, {
      "\\R": "\\mathbb{R}",
      "\\N": "\\mathbb{N}",
    });

    const macros = getMathMacros(view.state);
    expect(macros).toEqual({
      "\\R": "\\mathcal{R}", // file overrides
      "\\N": "\\mathbb{N}", // project preserved
      "\\Z": "\\mathbb{Z}", // file added
    });
  });
});

describe("macros in MathWidget (inline)", () => {
  it("renders with macros applied", () => {
    const macros = { "\\R": "\\mathbb{R}" };
    const widget = new MathWidget("\\R", "$\\R$", false, macros);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
    // The rendered output should contain the expanded macro
    expect(el.textContent).toContain("R");
  });

  it("eq returns false when macros differ", () => {
    const a = new MathWidget("\\R", "$\\R$", false, { "\\R": "\\mathbb{R}" });
    const b = new MathWidget("\\R", "$\\R$", false, { "\\R": "\\mathcal{R}" });
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when macros match", () => {
    const macros = { "\\R": "\\mathbb{R}" };
    const a = new MathWidget("\\R", "$\\R$", false, macros);
    const b = new MathWidget("\\R", "$\\R$", false, { ...macros });
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns true with empty macros on both sides", () => {
    const a = new MathWidget("x", "$x$", false, {});
    const b = new MathWidget("x", "$x$", false, {});
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when one has macros and other does not", () => {
    const a = new MathWidget("\\R", "$\\R$", false, { "\\R": "\\mathbb{R}" });
    const b = new MathWidget("\\R", "$\\R$", false);
    expect(a.eq(b)).toBe(false);
  });
});

describe("non-builtin macros in MathWidget", () => {
  it("renders macro with argument (#1) correctly", () => {
    const macros = { "\\bm": "\\boldsymbol{#1}" };
    const widget = new MathWidget("\\bm{x}", "$\\bm{x}$", false, macros);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
    // Should not contain an error
    expect(el.querySelector(".katex-error")).toBeNull();
  });

  it("renders non-builtin macro without KaTeX built-in", () => {
    // \\e is not a KaTeX built-in, so this exercises the custom macro path
    const macros = { "\\e": "\\varepsilon" };
    const widget = new MathWidget("\\e", "$\\e$", false, macros);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
    expect(el.querySelector(".katex-error")).toBeNull();
  });

  it("renders macro with braces in expansion", () => {
    const macros = { "\\set": "\\left\\{#1\\right\\}" };
    const widget = new MathWidget("\\set{x}", "$\\set{x}$", false, macros);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
    expect(el.querySelector(".katex-error")).toBeNull();
  });
});

describe("macros in MathWidget (display)", () => {
  it("renders with macros applied", () => {
    const macros = { "\\R": "\\mathbb{R}" };
    const widget = new MathWidget("\\R", "$$\\R$$", true, macros);
    const el = widget.toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
  });

  it("eq returns false when macros differ", () => {
    const a = new MathWidget("\\R", "$$\\R$$", true, { "\\R": "\\mathbb{R}" });
    const b = new MathWidget("\\R", "$$\\R$$", true, { "\\R": "\\mathcal{R}" });
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when macros match", () => {
    const macros = { "\\R": "\\mathbb{R}" };
    const a = new MathWidget("\\R", "$$\\R$$", true, macros);
    const b = new MathWidget("\\R", "$$\\R$$", true, { ...macros });
    expect(a.eq(b)).toBe(true);
  });
});

describe("collectMathRanges with frontmatter macros", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("passes macros from frontmatter to math widgets", () => {
    const doc = "---\nmath:\n  \\R: \\mathbb{R}\n---\n\n$\\R$";
    view = createView(doc, 0);
    const ranges = collectMathRanges(view);
    // The math expression should be collected for rendering
    expect(ranges.length).toBe(1);
  });

  it("works without frontmatter macros", () => {
    const doc = "---\ntitle: Hello\n---\n\n$x^2$";
    view = createView(doc, 0);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });
});

describe("live update on frontmatter change", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("detects macro changes when frontmatter is edited", () => {
    const doc = "---\nmath:\n  \\R: \\mathbb{R}\n---\n\n$\\R$";
    view = createView(doc, 0);

    const macrosBefore = getMathMacros(view.state);
    expect(macrosBefore).toEqual({ "\\R": "\\mathbb{R}" });

    // Simulate editing the frontmatter to change the macro expansion
    // Replace "\mathbb{R}" with "\mathcal{R}"
    const oldExpansion = "\\mathbb{R}";
    const newExpansion = "\\mathcal{R}";
    const oldPos = doc.indexOf(oldExpansion);
    view.dispatch({
      changes: {
        from: oldPos,
        to: oldPos + oldExpansion.length,
        insert: newExpansion,
      },
    });

    const macrosAfter = getMathMacros(view.state);
    expect(macrosAfter).toEqual({ "\\R": "\\mathcal{R}" });
  });

  it("detects when macros are added to frontmatter", () => {
    const doc = "---\ntitle: Hello\n---\n\n$x$";
    view = createView(doc, 0);

    expect(getMathMacros(view.state)).toEqual({});

    // Insert a math section into the frontmatter before the closing ---
    const closingPos = doc.indexOf("\n---", 4);
    view.dispatch({
      changes: {
        from: closingPos,
        to: closingPos,
        insert: "\nmath:\n  \\R: \\mathbb{R}",
      },
    });

    const macros = getMathMacros(view.state);
    expect(macros).toEqual({ "\\R": "\\mathbb{R}" });
  });
});
