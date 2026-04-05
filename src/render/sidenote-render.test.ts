import { afterEach, describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  type DecorationSet,
  EditorView,
  type ViewPlugin,
} from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { markdown } from "@codemirror/lang-markdown";
import { footnoteExtension } from "../parser/footnote";
import { frontmatterField } from "../editor/frontmatter-state";
import { mathMacrosField } from "./math-macros";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import { renderInlineMarkdown } from "./inline-render";
import {
  computeSidenoteOffsets,
  type SidenoteMeasurement,
  FootnoteSectionWidget,
  FootnoteInlineWidget,
  buildSidenoteDecorations,
  footnoteSectionPlugin,
  sidenoteDecorationField,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
  footnoteInlineToggleEffect,
  footnoteInlineExpandedField,
} from "./sidenote-render";
import { editorFocusField, focusEffect } from "./render-utils";
import { createMockEditorView, createTestView, getDecorationSpecs } from "../test-utils";

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

/** Create an EditorState with all fields including collapsed + inline expansion. */
function createFullState(doc: string, cursorPos?: number): EditorState {
  return EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [
      markdown({ extensions: [footnoteExtension] }),
      frontmatterField,
      mathMacrosField,
      documentSemanticsField,
      sidenotesCollapsedField,
      footnoteInlineExpandedField,
    ],
  });
}

function createDecoratedState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ extensions: [footnoteExtension] }),
      frontmatterField,
      mathMacrosField,
      documentSemanticsField,
      editorFocusField,
      sidenotesCollapsedField,
      footnoteInlineExpandedField,
      sidenoteDecorationField,
    ],
  });
}

function getWidgetFromDecorations<T>(decorations: DecorationSet, widgetClass: string): T {
  const cursor = decorations.iter();
  while (cursor.value) {
    const widget = cursor.value.spec.widget;
    if (widget?.constructor?.name === widgetClass) {
      return widget as T;
    }
    cursor.next();
  }
  throw new Error(`expected widget ${widgetClass}`);
}

function focusState(state: EditorState): EditorState {
  return state.update({ effects: focusEffect.of(true) }).state;
}

interface FootnoteSectionPluginValue {
  decorations: DecorationSet;
}

let pluginView: EditorView | undefined;

afterEach(() => {
  pluginView?.destroy();
  pluginView = undefined;
});

function createFootnoteSectionView(doc: string): EditorView {
  pluginView = createTestView(doc, {
    focus: false,
    extensions: [
      markdown({ extensions: [footnoteExtension] }),
      frontmatterField,
      mathMacrosField,
      documentSemanticsField,
      sidenotesCollapsedField,
      footnoteSectionPlugin,
    ],
  });
  return pluginView;
}

function getFootnoteSectionPlugin(v: EditorView): FootnoteSectionPluginValue {
  const plugin = v.plugin(
    footnoteSectionPlugin as unknown as ViewPlugin<FootnoteSectionPluginValue>,
  );
  expect(plugin).toBeDefined();
  if (!plugin) {
    throw new Error("footnoteSectionPlugin is not installed");
  }
  return plugin;
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

describe("buildSidenoteDecorations — expanded mode (body in CM6)", () => {
  // Document: "Text [^1] end\n\n[^1]: See $x^2$ here"
  // The ref [^1] spans some range, and the def [^1]: spans the last line.
  const doc = "Text [^1] end\n\n[^1]: See $x^2$ here";

  it("keeps body as CM6 content with line styling when cursor is outside def", () => {
    // #430: Body text stays in CM6 document model, styled via Decoration.line.
    // Label is hidden via Decoration.replace with a small label widget.
    const state = createState(doc, 0);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Should have the body line class (not the old hide class)
    const bodyDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefBody));
    expect(bodyDecos.length).toBe(1);

    // Should NOT have the collapsed hide class
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(0);

    // Label should be replaced with a FootnoteDefLabelWidget
    const labelWidgets = specs.filter((s) => s.widgetClass === "FootnoteDefLabelWidget");
    expect(labelWidgets.length).toBe(1);

    // No FootnoteBodyWidget — body stays as normal CM6 text
    const bodyWidgets = specs.filter((s) => s.widgetClass === "FootnoteBodyWidget");
    expect(bodyWidgets.length).toBe(0);
  });

  it("shows label as source when cursor is on the label (heading-like pattern)", () => {
    // When cursor is on [^1]:, label should be visible as source text.
    const defStart = doc.indexOf("[^1]:");
    const state = createState(doc, defStart);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Body line class should still be present
    const bodyDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefBody));
    expect(bodyDecos.length).toBe(1);

    // Label widget should NOT be present (label is shown as source)
    const labelWidgets = specs.filter((s) => s.widgetClass === "FootnoteDefLabelWidget");
    expect(labelWidgets.length).toBe(0);
  });

  it("hides label when cursor is in the body text (not on label)", () => {
    // #430: Cursor in body text — label is hidden, body stays as CM6 content.
    const bodyStart = doc.indexOf("See $x^2$");
    const state = createState(doc, bodyStart);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Body line class present
    const bodyDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefBody));
    expect(bodyDecos.length).toBe(1);

    // Label should be replaced with widget (cursor is not on the label)
    const labelWidgets = specs.filter((s) => s.widgetClass === "FootnoteDefLabelWidget");
    expect(labelWidgets.length).toBe(1);

    // No FootnoteBodyWidget — body stays as normal CM6 text
    const bodyWidgets = specs.filter((s) => s.widgetClass === "FootnoteBodyWidget");
    expect(bodyWidgets.length).toBe(0);
  });

  it("hides label with body styling when editor is unfocused", () => {
    // #430: Unfocused editor should show body styling, not collapse line.
    const state = createState(doc, 0);
    const decos = buildSidenoteDecorations(state, false);
    const specs = getDecorationSpecs(decos);

    // Body line class present (footnote text styled)
    const bodyDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefBody));
    expect(bodyDecos.length).toBe(1);

    // Label should be replaced with widget
    const labelWidgets = specs.filter((s) => s.widgetClass === "FootnoteDefLabelWidget");
    expect(labelWidgets.length).toBe(1);
  });

  it("label replacement covers only the [^id]: prefix, not body text (#430)", () => {
    // CRITICAL: Decoration.replace must NOT extend over body text.
    // This ensures CM6 inline extensions render math/bold/etc. naturally.
    const defStart = doc.indexOf("[^1]:");
    const labelEnd = defStart + "[^1]:".length;
    const state = createState(doc, 0);
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // The label widget replacement should cover only the label range
    const labelWidgets = specs.filter((s) => s.widgetClass === "FootnoteDefLabelWidget");
    expect(labelWidgets.length).toBe(1);
    expect(labelWidgets[0].from).toBe(defStart);
    expect(labelWidgets[0].to).toBe(labelEnd);
  });
});

describe("buildSidenoteDecorations — collapsed mode", () => {
  const doc = "Text [^1] end\n\n[^1]: See $x^2$ here";

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

    // No body-styling class in collapsed mode
    const bodyDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefBody));
    expect(bodyDecos.length).toBe(0);
  });

  it("replaces entire def line content (label+body) when collapsed (#402)", () => {
    // Regression #402: only the body was replaced, leaving [^id]: label visible.
    // The replace decoration must cover def.from..def.to (the full line),
    // not just def.labelTo..def.to (only the body after the label).
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

    // The def starts at position 16 ("Text [^1] end\n\n" = 15 chars, def at 16)
    const defStart = doc.indexOf("[^1]:");
    const defEnd = doc.length;

    // The replace decoration should span the entire def (from..to),
    // not start at labelTo (which would leave the [^1]: label exposed)
    const replaceDecos = specs.filter(
      (s) => !s.class && !s.widgetClass && s.from !== s.to,
    );
    expect(replaceDecos.length).toBe(1);
    expect(replaceDecos[0].from).toBe(defStart);
    expect(replaceDecos[0].to).toBe(defEnd);
  });

  it("replaces entire def line even with multiple footnotes when collapsed (#402)", () => {
    // Ensure all def lines are fully replaced, not just the first one.
    const multiDoc = "A[^a] B[^b]\n\n[^a]: First note\n\n[^b]: Second note";
    const state = EditorState.create({
      doc: multiDoc,
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

    // Both def lines should have the hide class
    const lineDecos = specs.filter((s) => s.class?.includes(CSS.sidenoteDefLine));
    expect(lineDecos.length).toBe(2);

    // Both defs should have replace decorations covering the full line
    const replaceDecos = specs.filter(
      (s) => !s.class && !s.widgetClass && s.from !== s.to,
    );
    expect(replaceDecos.length).toBe(2);

    // First def: [^a]: First note
    const defAStart = multiDoc.indexOf("[^a]:");
    const defAEnd = multiDoc.indexOf("\n", defAStart);
    expect(replaceDecos[0].from).toBe(defAStart);
    expect(replaceDecos[0].to).toBe(defAEnd);

    // Second def: [^b]: Second note
    const defBStart = multiDoc.indexOf("[^b]:");
    const defBEnd = multiDoc.length;
    expect(replaceDecos[1].from).toBe(defBStart);
    expect(replaceDecos[1].to).toBe(defBEnd);
  });
});

describe("sidenote decoration invalidation", () => {
  it("does not rebuild on unrelated semantic slice changes", () => {
    const doc = [
      "Text [^1] end",
      "",
      "[^1]: Note",
      "",
      "# Old heading",
    ].join("\n");
    const state = createDecoratedState(doc);
    const beforeAnalysis = state.field(documentSemanticsField);
    const beforeDecorations = state.field(sidenoteDecorationField);
    const headingText = doc.indexOf("Old");

    const next = state.update({
      changes: {
        from: headingText,
        to: headingText + "Old".length,
        insert: "New",
      },
    }).state;

    const afterAnalysis = next.field(documentSemanticsField);
    expect(afterAnalysis).not.toBe(beforeAnalysis);
    expect(getDocumentAnalysisSliceRevision(afterAnalysis, "footnotes")).toBe(
      getDocumentAnalysisSliceRevision(beforeAnalysis, "footnotes"),
    );
    expect(next.field(sidenoteDecorationField)).toBe(beforeDecorations);
  });

  it("rebuilds when the footnote slice changes", () => {
    const doc = "Text [^1] end\n\n[^1]: Note";
    const state = createDecoratedState(doc);
    const beforeDecorations = state.field(sidenoteDecorationField);
    const noteText = doc.indexOf("Note");

    const next = state.update({
      changes: {
        from: noteText,
        to: noteText + "Note".length,
        insert: "Remark",
      },
    }).state;

    expect(next.field(sidenoteDecorationField)).not.toBe(beforeDecorations);
  });

  it("ignores selection changes outside active ref and label ranges", () => {
    const doc = "Lead paragraph.\n\nText [^1] end\n\n[^1]: Note";
    const state = focusState(createDecoratedState(doc, 0));
    const beforeDecorations = state.field(sidenoteDecorationField);
    const paragraphPos = doc.indexOf("Text");

    const next = state.update({
      selection: { anchor: paragraphPos },
    }).state;

    expect(next.field(sidenoteDecorationField)).toBe(beforeDecorations);
  });

  it("rebuilds only when selection crosses an active ref or label", () => {
    const doc = "Text [^1] end\n\n[^1]: Note";
    let state = focusState(createDecoratedState(doc, 0));
    const refStart = doc.indexOf("[^1]");
    const refInside = refStart + 2;
    const labelStart = doc.lastIndexOf("[^1]:");

    const beforeDecorations = state.field(sidenoteDecorationField);
    state = state.update({ selection: { anchor: refStart } }).state;
    const refDecorations = state.field(sidenoteDecorationField);
    expect(refDecorations).not.toBe(beforeDecorations);

    state = state.update({ selection: { anchor: refInside } }).state;
    expect(state.field(sidenoteDecorationField)).toBe(refDecorations);

    state = state.update({ selection: { anchor: labelStart } }).state;
    expect(state.field(sidenoteDecorationField)).not.toBe(refDecorations);
  });

  it("does not rebuild when frontmatter changes but math macros stay the same", () => {
    const doc = [
      "---",
      "title: Old",
      "math:",
      "  \\R: alpha",
      "---",
      "",
      "Text [^1]",
      "",
      "[^1]: Note",
    ].join("\n");
    const state = createDecoratedState(doc);
    const beforeDecorations = state.field(sidenoteDecorationField);
    const titleText = doc.indexOf("Old");

    const next = state.update({
      changes: {
        from: titleText,
        to: titleText + "Old".length,
        insert: "New",
      },
    }).state;

    expect(next.field(sidenoteDecorationField)).toBe(beforeDecorations);
  });

  it("rebuilds when inline footnote macros change", () => {
    const doc = [
      "---",
      "math:",
      "  \\R: alpha",
      "---",
      "",
      "Text [^1]",
      "",
      "[^1]: See $\\R$",
    ].join("\n");
    let state = createDecoratedState(doc);
    state = state.update({
      effects: [
        sidenotesCollapsedEffect.of(true),
        footnoteInlineToggleEffect.of({ id: "1", expanded: true }),
      ],
    }).state;
    const beforeDecorations = state.field(sidenoteDecorationField);
    const macroText = doc.indexOf("alpha");

    const next = state.update({
      changes: {
        from: macroText,
        to: macroText + "alpha".length,
        insert: "beta",
      },
    }).state;

    expect(next.field(sidenoteDecorationField)).not.toBe(beforeDecorations);
  });
});

describe("footnote section invalidation", () => {
  it("does not rebuild on unrelated semantic changes while collapsed", () => {
    const doc = [
      "Text [^1] end",
      "",
      "[^1]: Note",
      "",
      "# Old heading",
    ].join("\n");
    const v = createFootnoteSectionView(doc);
    v.dispatch({ effects: sidenotesCollapsedEffect.of(true) });
    const beforeAnalysis = v.state.field(documentSemanticsField);
    const beforeDecorations = getFootnoteSectionPlugin(v).decorations;
    const headingText = doc.indexOf("Old");

    v.dispatch({
      changes: {
        from: headingText,
        to: headingText + "Old".length,
        insert: "New",
      },
    });

    const afterAnalysis = v.state.field(documentSemanticsField);
    expect(getDocumentAnalysisSliceRevision(afterAnalysis, "footnotes")).toBe(
      getDocumentAnalysisSliceRevision(beforeAnalysis, "footnotes"),
    );
    expect(getFootnoteSectionPlugin(v).decorations).toBe(beforeDecorations);
  });

  it("rebuilds when the footnote slice changes while collapsed", () => {
    const doc = "Text [^1] end\n\n[^1]: Note";
    const v = createFootnoteSectionView(doc);
    v.dispatch({ effects: sidenotesCollapsedEffect.of(true) });
    const beforeDecorations = getFootnoteSectionPlugin(v).decorations;
    const noteText = doc.indexOf("Note");

    v.dispatch({
      changes: {
        from: noteText,
        to: noteText + "Note".length,
        insert: "Remark",
      },
    });

    expect(getFootnoteSectionPlugin(v).decorations).not.toBe(beforeDecorations);
  });

  it("rebuilds when footnote macros change while collapsed", () => {
    const doc = [
      "---",
      "math:",
      "  \\R: alpha",
      "---",
      "",
      "Text [^1]",
      "",
      "[^1]: See $\\R$",
    ].join("\n");
    const v = createFootnoteSectionView(doc);
    v.dispatch({ effects: sidenotesCollapsedEffect.of(true) });
    const beforeDecorations = getFootnoteSectionPlugin(v).decorations;
    const macroText = doc.indexOf("alpha");

    v.dispatch({
      changes: {
        from: macroText,
        to: macroText + "alpha".length,
        insert: "beta",
      },
    });

    expect(getFootnoteSectionPlugin(v).decorations).not.toBe(beforeDecorations);
  });
});

describe("FootnoteSectionWidget", () => {
  it("eq returns false when macros change", () => {
    const entries = [{ num: 1, id: "note-1", content: "$\\R$", defFrom: 10 }];
    const a = new FootnoteSectionWidget(entries, { "\\R": "\\mathbb{R}" });
    const b = new FootnoteSectionWidget(entries, { "\\R": "\\mathbf{R}" });

    expect(a.eq(b)).toBe(false);
  });

  it("re-attaches entry click handlers when cloned from cache", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new FootnoteSectionWidget(
      [{ num: 1, id: "note-1", content: "Body", defFrom: 24 }],
      {},
    );

    widget.toDOM(view);
    const cloned = widget.toDOM(view);
    const entry = cloned.querySelector<HTMLElement>(".cf-bibliography-entry");
    entry?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      effects: sidenotesCollapsedEffect.of(false),
      selection: { anchor: 24 },
      scrollIntoView: true,
    });
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

// ---------------------------------------------------------------------------
// Inline footnote expansion (#458)
// ---------------------------------------------------------------------------

describe("footnoteInlineExpandedField", () => {
  it("starts empty", () => {
    const state = createFullState("Hello [^1]\n\n[^1]: Note");
    const expanded = state.field(footnoteInlineExpandedField);
    expect(expanded.size).toBe(0);
  });

  it("adds an id when expand effect is dispatched", () => {
    const state = createFullState("Hello [^1]\n\n[^1]: Note");
    const next = state.update({
      effects: footnoteInlineToggleEffect.of({ id: "1", expanded: true }),
    }).state;
    const expanded = next.field(footnoteInlineExpandedField);
    expect(expanded.has("1")).toBe(true);
    expect(expanded.size).toBe(1);
  });

  it("removes an id when collapse effect is dispatched", () => {
    const state = createFullState("Hello [^1]\n\n[^1]: Note");
    const expanded = state.update({
      effects: footnoteInlineToggleEffect.of({ id: "1", expanded: true }),
    }).state;
    const collapsed = expanded.update({
      effects: footnoteInlineToggleEffect.of({ id: "1", expanded: false }),
    }).state;
    expect(collapsed.field(footnoteInlineExpandedField).has("1")).toBe(false);
    expect(collapsed.field(footnoteInlineExpandedField).size).toBe(0);
  });

  it("tracks multiple expanded footnotes independently", () => {
    const doc = "A[^a] B[^b]\n\n[^a]: First\n\n[^b]: Second";
    let state = createFullState(doc);
    state = state.update({
      effects: footnoteInlineToggleEffect.of({ id: "a", expanded: true }),
    }).state;
    state = state.update({
      effects: footnoteInlineToggleEffect.of({ id: "b", expanded: true }),
    }).state;
    const expanded = state.field(footnoteInlineExpandedField);
    expect(expanded.has("a")).toBe(true);
    expect(expanded.has("b")).toBe(true);
    expect(expanded.size).toBe(2);

    // Collapse only "a"
    state = state.update({
      effects: footnoteInlineToggleEffect.of({ id: "a", expanded: false }),
    }).state;
    const afterCollapse = state.field(footnoteInlineExpandedField);
    expect(afterCollapse.has("a")).toBe(false);
    expect(afterCollapse.has("b")).toBe(true);
    expect(afterCollapse.size).toBe(1);
  });
});

describe("buildSidenoteDecorations — inline expansion (#458)", () => {
  const doc = "Text [^1] end\n\n[^1]: See $x^2$ here";

  it("shows inline widget when collapsed + footnote expanded", () => {
    // #458: Clicking a footnote ref in collapsed mode should show the
    // definition inline below the ref line, not scroll away.
    let state = createFullState(doc, 0);
    state = state.update({
      effects: [
        sidenotesCollapsedEffect.of(true),
        footnoteInlineToggleEffect.of({ id: "1", expanded: true }),
      ],
    }).state;
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    // Should have a FootnoteInlineWidget
    const inlineWidgets = specs.filter(
      (s) => s.widgetClass === "FootnoteInlineWidget",
    );
    expect(inlineWidgets.length).toBe(1);

    // The inline widget should be placed at the end of the ref's line
    const refLineEnd = doc.indexOf("\n");
    expect(inlineWidgets[0].from).toBe(refLineEnd);
  });

  it("does not show inline widget when not collapsed", () => {
    // Inline expansion only applies in collapsed-sidenotes mode.
    let state = createFullState(doc, 0);
    state = state.update({
      effects: footnoteInlineToggleEffect.of({ id: "1", expanded: true }),
    }).state;
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    const inlineWidgets = specs.filter(
      (s) => s.widgetClass === "FootnoteInlineWidget",
    );
    expect(inlineWidgets.length).toBe(0);
  });

  it("does not show inline widget when collapsed but footnote not expanded", () => {
    let state = createFullState(doc, 0);
    state = state.update({
      effects: sidenotesCollapsedEffect.of(true),
    }).state;
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    const inlineWidgets = specs.filter(
      (s) => s.widgetClass === "FootnoteInlineWidget",
    );
    expect(inlineWidgets.length).toBe(0);
  });

  it("shows multiple inline widgets for multiple expanded footnotes", () => {
    const multiDoc = "A[^a] B[^b]\n\n[^a]: First note\n\n[^b]: Second note";
    let state = createFullState(multiDoc, 0);
    state = state.update({
      effects: [
        sidenotesCollapsedEffect.of(true),
        footnoteInlineToggleEffect.of({ id: "a", expanded: true }),
        footnoteInlineToggleEffect.of({ id: "b", expanded: true }),
      ],
    }).state;
    const decos = buildSidenoteDecorations(state, true);
    const specs = getDecorationSpecs(decos);

    const inlineWidgets = specs.filter(
      (s) => s.widgetClass === "FootnoteInlineWidget",
    );
    expect(inlineWidgets.length).toBe(2);
  });
});

describe("FootnoteInlineWidget", () => {
  it("eq returns true for identical widgets", () => {
    const a = new FootnoteInlineWidget(1, "note", "Content", {}, 10);
    const b = new FootnoteInlineWidget(1, "note", "Content", {}, 10);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when content differs", () => {
    const a = new FootnoteInlineWidget(1, "note", "Content A", {}, 10);
    const b = new FootnoteInlineWidget(1, "note", "Content B", {}, 10);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when macros differ", () => {
    const a = new FootnoteInlineWidget(1, "note", "$\\R$", { "\\R": "\\mathbb{R}" }, 10);
    const b = new FootnoteInlineWidget(1, "note", "$\\R$", { "\\R": "\\mathbf{R}" }, 10);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when number differs", () => {
    const a = new FootnoteInlineWidget(1, "note", "Content", {}, 10);
    const b = new FootnoteInlineWidget(2, "note", "Content", {}, 10);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when defFrom differs", () => {
    const a = new FootnoteInlineWidget(1, "note", "Content", {}, 10);
    const b = new FootnoteInlineWidget(1, "note", "Content", {}, 20);
    expect(a.eq(b)).toBe(false);
  });

  it("re-attaches the edit button handler when cloned from cache", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new FootnoteInlineWidget(1, "note", "Content", {}, 10);

    widget.toDOM(view);
    const cloned = widget.toDOM(view);
    const editBtn = cloned.querySelector<HTMLButtonElement>(".cf-footnote-inline-edit");
    editBtn?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledWith({
      effects: [
        sidenotesCollapsedEffect.of(false),
        footnoteInlineToggleEffect.of({ id: "note", expanded: false }),
      ],
      selection: { anchor: 10 },
      scrollIntoView: true,
    });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("removes the edit handler when the widget is destroyed", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new FootnoteInlineWidget(1, "note", "Content", {}, 10);

    const dom = widget.toDOM(view);
    const editBtn = dom.querySelector<HTMLButtonElement>(".cf-footnote-inline-edit");
    editBtn?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);

    dispatch.mockClear();
    focus.mockClear();

    widget.destroy(dom);
    editBtn?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("FootnoteRefWidget", () => {
  it("removes the ref click handler when the widget is destroyed", () => {
    let state = createFullState("Text [^1] end\n\n[^1]: Note");
    state = state.update({
      effects: sidenotesCollapsedEffect.of(true),
    }).state;

    const widget = getWidgetFromDecorations<{
      toDOM(view?: EditorView): HTMLElement;
      destroy(dom: HTMLElement): void;
    }>(buildSidenoteDecorations(state, true), "FootnoteRefWidget");

    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({
      focus,
      dispatch,
      state: {
        field(requestedField: unknown, fallback: unknown) {
          return requestedField === sidenotesCollapsedField ? true : fallback;
        },
      },
    });

    const dom = widget.toDOM(view);
    dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledWith({
      effects: footnoteInlineToggleEffect.of({ id: "1", expanded: true }),
    });

    dispatch.mockClear();
    focus.mockClear();

    widget.destroy(dom);
    dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
