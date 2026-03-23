import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { markdown } from "@codemirror/lang-markdown";
import { footnoteExtension } from "../parser/footnote";
import { frontmatterField } from "../editor/frontmatter-state";
import { mathMacrosField } from "./math-macros";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { renderInlineMarkdown } from "./inline-render";
import {
  computeSidenoteOffsets,
  type SidenoteMeasurement,
  FootnoteBodyWidget,
  FootnoteSectionWidget,
  buildSidenoteDecorations,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
} from "./sidenote-render";
import { getDecorationSpecs } from "../test-utils";

/** Create an EditorState with footnote parsing and all fields needed by sidenote decorations. */
function createState(doc: string, cursorPos?: number): EditorState {
  return EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [
      markdown({ extensions: [footnoteExtension] }),
      frontmatterField,
      mathMacrosField,
      documentSemanticsField,
    ],
  });
}

describe("computeSidenoteOffsets", () => {
  it("returns all zeros when sidenotes don't overlap", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 0, height: 40 },
      { top: 100, height: 40 },
      { top: 200, height: 40 },
    ];
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 0, 0]);
  });

  it("pushes the second sidenote down when two overlap", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 50 },
      { top: 120, height: 50 },
    ];
    // First bottom = 100+50 = 150, gap = 4 → second needs top >= 154
    // offset = 154 - 120 = 34
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34]);
  });

  it("cascades offsets through three overlapping sidenotes", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 50 },
      { top: 120, height: 50 },
      { top: 130, height: 50 },
    ];
    // Sidenote 0: offset=0, bottom=150
    // Sidenote 1: 120 < 154 → offset=34, bottom=120+34+50=204
    // Sidenote 2: 130 < 208 → offset=78, bottom=130+78+50=258
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34, 78]);
  });

  it("handles sidenotes at the exact same position", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 30 },
      { top: 100, height: 30 },
    ];
    // First bottom = 130, gap=4 → second needs 134
    // offset = 134 - 100 = 34
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34]);
  });

  it("returns empty array for empty input", () => {
    expect(computeSidenoteOffsets([])).toEqual([]);
  });

  it("returns [0] for a single sidenote", () => {
    expect(computeSidenoteOffsets([{ top: 50, height: 40 }])).toEqual([0]);
  });

  it("respects custom gap parameter", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 50 },
      { top: 140, height: 50 },
    ];
    // gap=20 → second needs top >= 170 → offset = 170-140 = 30
    expect(computeSidenoteOffsets(measurements, 20)).toEqual([0, 30]);
  });

  it("only pushes sidenotes that actually overlap", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 0, height: 40 },
      { top: 10, height: 40 },   // overlaps with first
      { top: 200, height: 40 },  // no overlap
      { top: 210, height: 40 },  // overlaps with third
    ];
    // Sidenote 0: offset=0, bottom=40
    // Sidenote 1: 10 < 44 → offset=34, bottom=10+34+40=84
    // Sidenote 2: 200 >= 88 → offset=0, bottom=240
    // Sidenote 3: 210 < 244 → offset=34, bottom=210+34+40=284
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34, 0, 34]);
  });
});

describe("FootnoteBodyWidget", () => {
  it("renders inline math in footnote body", () => {
    const widget = new FootnoteBodyWidget("See $x^2$ here", {});
    const el = widget.createDOM();
    expect(el.className).toBe(CSS.sidenoteBodyRendered);
    expect(el.querySelector(".katex")).not.toBeNull();
  });

  it("renders bold in footnote body", () => {
    const widget = new FootnoteBodyWidget("Some **bold** text", {});
    const el = widget.createDOM();
    expect(el.querySelector("strong")).not.toBeNull();
    expect(el.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders plain text in footnote body", () => {
    const widget = new FootnoteBodyWidget("plain text", {});
    const el = widget.createDOM();
    expect(el.textContent).toBe("plain text");
  });

  it("eq returns true for same content and macros", () => {
    const macros = { "\\RR": "\\mathbb{R}" };
    const a = new FootnoteBodyWidget("$\\RR$", macros);
    const b = new FootnoteBodyWidget("$\\RR$", macros);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different content", () => {
    const a = new FootnoteBodyWidget("$x$", {});
    const b = new FootnoteBodyWidget("$y$", {});
    expect(a.eq(b)).toBe(false);
  });
});

describe("buildSidenoteDecorations — footnote def cursor zones", () => {
  // Document: "Text [^1] end\n\n[^1]: See $x^2$ here"
  // The ref [^1] spans some range, and the def [^1]: spans the last line.
  const doc = "Text [^1] end\n\n[^1]: See $x^2$ here";

  it("collapses def line when cursor is outside the def", () => {
    // Cursor at start of document, well outside the def
    const state = createState(doc, 0);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Should have a line class decoration on the def line
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(1);
  });

  it("renders body as widget when cursor is on the label", () => {
    // The def starts at position 15 (after "Text [^1] end\n\n")
    // [^1]: spans 15..20 (label), body starts after that
    // Place cursor at position 15 (start of label)
    const defStart = doc.indexOf("[^1]:");
    const state = createState(doc, defStart);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Should NOT have the line-hide class (line is visible for editing)
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(0);

    // Should have a widget replacement for the body (FootnoteBodyWidget)
    const bodyWidgets = specs.filter((s) => s.widgetClass === "FootnoteBodyWidget");
    expect(bodyWidgets.length).toBe(1);
  });

  it("keeps body rendered via widget when cursor is in the body text", () => {
    // Place cursor inside the body text (after [^1]:)
    const bodyStart = doc.indexOf("See $x^2$");
    const state = createState(doc, bodyStart);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Should NOT have the line-hide class (line visible for editing label)
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(0);

    // Body should be rendered via widget (inline math, bold, etc. stay rendered)
    const bodyWidgets = specs.filter((s) => s.widgetClass === "FootnoteBodyWidget");
    expect(bodyWidgets.length).toBe(1);
  });

  it("keeps def hidden when editor is unfocused", () => {
    const state = createState(doc, 0);
    const decos = buildSidenoteDecorations(state, false);
    const specs = getDecorationSpecs(decos);

    // Should have the line-hide class even with cursor at 0
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(1);
  });

  it("still renders ref superscripts and hides defs when collapsed", () => {
    // Regression: collapsed mode must not expose raw footnote markdown.
    // Refs should render as superscript numbers; defs should be hidden
    // (content is shown in the FootnoteSectionWidget at document end).
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [footnoteExtension] }),
        frontmatterField,
        mathMacrosField,
        documentSemanticsField,
        sidenotesCollapsedField,
      ],
    });
    const collapsedState = state.update({
      effects: sidenotesCollapsedEffect.of(true),
    }).state;
    const decos = buildSidenoteDecorations(collapsedState, true);
    const specs = getDecorationSpecs(decos);

    // Ref should be replaced with a FootnoteRefWidget
    const refWidgets = specs.filter((s) => s.widgetClass === "FootnoteRefWidget");
    expect(refWidgets.length).toBe(1);

    // Def line should have the hide class
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(1);

    // Def body should NOT have a FootnoteBodyWidget (cursor-in-def editing
    // is disabled in collapsed mode; content is in the footnote section)
    const bodyWidgets = specs.filter((s) => s.widgetClass === "FootnoteBodyWidget");
    expect(bodyWidgets.length).toBe(0);
  });
});

describe("FootnoteSectionWidget", () => {
  it("eq returns false when macros change", () => {
    const entries = [{ num: 1, id: "note-1", content: "$\\R$", defFrom: 10 }];
    const a = new FootnoteSectionWidget(entries, { "\\R": "\\mathbb{R}" });
    const b = new FootnoteSectionWidget(entries, { "\\R": "\\mathbf{R}" });

    expect(a.eq(b)).toBe(false);
  });
});

describe("tooltip inline rendering", () => {
  it("renderInlineMarkdown renders math in footnote content", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "See $x^2$ for details", {}, "document-body");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).toContain("See");
    expect(container.textContent).toContain("for details");
  });

  it("renderInlineMarkdown renders bold in footnote content", () => {
    const container = document.createElement("div");
    renderInlineMarkdown(container, "**Important** note", {}, "document-body");
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Important");
  });

  it("renderInlineMarkdown uses macros for math rendering", () => {
    const container = document.createElement("div");
    const macros = { "\\RR": "\\mathbb{R}" };
    renderInlineMarkdown(container, "$\\RR$", macros, "document-body");
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
