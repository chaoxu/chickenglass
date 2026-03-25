import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import {
  createPluginRegistryField,
} from "../plugins/plugin-registry";
import { blockCounterField } from "../plugins/block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import type { BlockPlugin } from "../plugins/plugin-types";
import { CSS } from "../constants/css-classes";
import { createTestView, makeBlockPlugin } from "../test-utils";
import {
  CrossrefWidget,
  ClusteredCrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
  collectCrossrefRanges,
} from "./crossref-render";

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
];

/** Create an EditorView with all necessary extensions. */
function createView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({
        extensions: [
          fencedDiv,
          mathExtension,
          equationLabelExtension,
        ],
      }),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
    ],
  });
}

describe("CrossrefWidget", () => {
  it("renders resolved block reference as styled span", () => {
    const widget = new CrossrefWidget(
      { kind: "block", label: "Theorem 1", number: 1 },
      "[@thm-main]",
    );
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe(CSS.crossref);
    expect(el.textContent).toBe("Theorem 1");
    expect(el.getAttribute("aria-label")).toBe("[@thm-main]");
  });

  it("renders equation reference", () => {
    const widget = new CrossrefWidget(
      { kind: "equation", label: "Eq. (3)", number: 3 },
      "[@eq:foo]",
    );
    const el = widget.toDOM();
    expect(el.textContent).toBe("Eq. (3)");
  });

  it("eq returns true for identical resolved refs", () => {
    const a = new CrossrefWidget(
      { kind: "block", label: "Theorem 1", number: 1 },
      "[@thm-1]",
    );
    const b = new CrossrefWidget(
      { kind: "block", label: "Theorem 1", number: 1 },
      "[@thm-1]",
    );
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different labels", () => {
    const a = new CrossrefWidget(
      { kind: "block", label: "Theorem 1", number: 1 },
      "[@thm-1]",
    );
    const b = new CrossrefWidget(
      { kind: "block", label: "Theorem 2", number: 2 },
      "[@thm-2]",
    );
    expect(a.eq(b)).toBe(false);
  });
});

describe("UnresolvedRefWidget", () => {
  it("renders with warning style and strips bracket syntax (#406)", () => {
    const widget = new UnresolvedRefWidget("[@unknown]");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain(CSS.crossref);
    // Display text strips brackets for visual parity with table display path
    expect(el.textContent).toBe("unknown");
    expect(el.getAttribute("aria-label")).toBe("Unresolved reference");
  });

  it("eq returns true for same raw content", () => {
    const a = new UnresolvedRefWidget("[@x]");
    const b = new UnresolvedRefWidget("[@x]");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different raw content", () => {
    const a = new UnresolvedRefWidget("[@x]");
    const b = new UnresolvedRefWidget("[@y]");
    expect(a.eq(b)).toBe(false);
  });
});

describe("collectCrossrefRanges", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("collects block reference and renders as Theorem 1", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Main theorem.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    // Cursor at end of document, outside the reference
    view = createView(doc, doc.length);
    const ranges = collectCrossrefRanges(view);

    expect(ranges.length).toBeGreaterThanOrEqual(1);
    // Find the range for the crossref
    const refRange = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-main]",
    );
    expect(refRange).toBeDefined();
  });

  it("collects equation reference", () => {
    const doc = [
      "$$E = mc^2$$ {#eq:einstein}",
      "",
      "See [@eq:einstein].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectCrossrefRanges(view);

    const refRange = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:einstein]",
    );
    expect(refRange).toBeDefined();
  });

  it("does not collect reference when cursor is inside it", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Main theorem.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    // Position cursor inside the [@thm-main] text
    const refStart = doc.indexOf("[@thm-main]");
    view = createView(doc, refStart + 3);
    const ranges = collectCrossrefRanges(view);

    // The reference at the cursor should not be collected
    const refRange = ranges.find(
      (r) => r.from === refStart,
    );
    expect(refRange).toBeUndefined();
  });

  it("collects narrative @id reference", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Main theorem.",
      ":::",
      "",
      "As @thm-main shows.",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectCrossrefRanges(view);

    const refRange = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "@thm-main",
    );
    expect(refRange).toBeDefined();
  });

  it("handles multiple references in same document", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "::: {.definition #def-1}",
      "D1.",
      ":::",
      "",
      "See [@thm-1] and [@def-1].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectCrossrefRanges(view);

    // At minimum, we should find the two references
    expect(ranges.length).toBeGreaterThanOrEqual(2);
  });

  it("handles unresolved reference (citation fallback)", () => {
    const doc = "See [@karger2000] for details.";
    view = createView(doc, doc.length);
    const ranges = collectCrossrefRanges(view);

    expect(ranges.length).toBe(0);
  });

  it("handles empty document", () => {
    view = createView("");
    const ranges = collectCrossrefRanges(view);
    expect(ranges.length).toBe(0);
  });

  it("handles document without references", () => {
    view = createView("Just plain text.");
    const ranges = collectCrossrefRanges(view);
    expect(ranges.length).toBe(0);
  });
});

describe("Typora-style cursor toggle", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("reveals source when cursor enters reference region", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "See [@thm-1].",
    ].join("\n");
    const refStart = doc.indexOf("[@thm-1]");

    // Cursor outside: reference is collected
    view = createView(doc, doc.length);
    let ranges = collectCrossrefRanges(view);
    const outsideRef = ranges.find((r) => r.from === refStart);
    expect(outsideRef).toBeDefined();

    // Move cursor inside: reference is not collected
    view.dispatch({ selection: { anchor: refStart + 2 } });
    ranges = collectCrossrefRanges(view);
    const insideRef = ranges.find((r) => r.from === refStart);
    expect(insideRef).toBeUndefined();
  });

  it("only reveals the reference containing the cursor", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "::: {.definition #def-1}",
      "D1.",
      ":::",
      "",
      "See [@thm-1] and [@def-1].",
    ].join("\n");
    const thmRefStart = doc.indexOf("[@thm-1]");

    // Cursor inside [@thm-1] only
    view = createView(doc, thmRefStart + 2);
    const ranges = collectCrossrefRanges(view);

    // [@def-1] should still be collected, [@thm-1] should not
    const thmRange = ranges.find((r) => r.from === thmRefStart);
    expect(thmRange).toBeUndefined();

    const defRefStart = doc.indexOf("[@def-1]");
    const defRange = ranges.find((r) => r.from === defRefStart);
    expect(defRange).toBeDefined();
  });
});

describe("CrossrefWidget / UnresolvedRefWidget negative / edge-case", () => {
  it("CrossrefWidget renders number 0 without crashing", () => {
    const widget = new CrossrefWidget(
      { kind: "block", label: "Theorem 0", number: 0 },
      "[@thm-0]",
    );
    const el = widget.toDOM();
    expect(el.textContent).toBe("Theorem 0");
  });

  it("CrossrefWidget eq returns false for different kinds", () => {
    const a = new CrossrefWidget(
      { kind: "block", label: "Theorem 1", number: 1 },
      "[@thm-1]",
    );
    const b = new CrossrefWidget(
      { kind: "equation", label: "Theorem 1", number: 1 },
      "[@thm-1]",
    );
    expect(a.eq(b)).toBe(false);
  });

  it("UnresolvedRefWidget renders empty raw content without crashing", () => {
    const widget = new UnresolvedRefWidget("");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.textContent).toBe("");
  });

  it("UnresolvedRefWidget eq returns false for empty vs non-empty raw", () => {
    const a = new UnresolvedRefWidget("");
    const b = new UnresolvedRefWidget("[@x]");
    expect(a.eq(b)).toBe(false);
  });

  it("collectCrossrefRanges handles doc with only punctuation", () => {
    const view = createView("..., --- !!!", 0);
    const ranges = collectCrossrefRanges(view);
    expect(ranges.length).toBe(0);
    view.destroy();
  });
});

// Regression (#397): ClusteredCrossrefWidget must render per-item spans with
// data-ref-id attributes and separator text nodes, NOT a flat text join.
describe("ClusteredCrossrefWidget per-item spans", () => {
  it("renders one child span per item with data-ref-id", () => {
    const widget = new ClusteredCrossrefWidget(
      [
        { kind: "block", label: "Theorem 1", number: 1 },
        { kind: "block", label: "Theorem 2", number: 2 },
      ],
      ["thm-a", "thm-b"],
      "[@thm-a; @thm-b]",
    );
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe(CSS.crossref);

    // Should have two child spans (with text nodes between)
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("thm-a");
    expect(spans[0].textContent).toBe("Theorem 1");
    expect(spans[1].getAttribute("data-ref-id")).toBe("thm-b");
    expect(spans[1].textContent).toBe("Theorem 2");
  });

  it("renders separator text nodes between items", () => {
    const widget = new ClusteredCrossrefWidget(
      [
        { kind: "equation", label: "Eq. (1)", number: 1 },
        { kind: "equation", label: "Eq. (2)", number: 2 },
      ],
      ["eq:a", "eq:b"],
      "[@eq:a; @eq:b]",
    );
    const el = widget.toDOM();
    // childNodes: [span, "; ", span]
    expect(el.childNodes.length).toBe(3);
    expect(el.childNodes[1].nodeType).toBe(3); // text node
    expect(el.childNodes[1].textContent).toBe("; ");
  });

  it("separator text nodes have no data-ref-id", () => {
    const widget = new ClusteredCrossrefWidget(
      [
        { kind: "block", label: "Theorem 1", number: 1 },
        { kind: "block", label: "Theorem 2", number: 2 },
        { kind: "block", label: "Theorem 3", number: 3 },
      ],
      ["thm-a", "thm-b", "thm-c"],
      "[@thm-a; @thm-b; @thm-c]",
    );
    const el = widget.toDOM();
    // childNodes: [span, "; ", span, "; ", span]
    expect(el.childNodes.length).toBe(5);
    // Separators are text nodes (no data-ref-id)
    for (let i = 1; i < el.childNodes.length; i += 2) {
      expect(el.childNodes[i].nodeType).toBe(3);
      expect(el.childNodes[i].textContent).toBe("; ");
    }
    // All spans have data-ref-id
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(3);
  });

  it("full text content matches joined labels", () => {
    const widget = new ClusteredCrossrefWidget(
      [
        { kind: "equation", label: "Eq. (1)", number: 1 },
        { kind: "equation", label: "Eq. (2)", number: 2 },
      ],
      ["eq:a", "eq:b"],
      "[@eq:a; @eq:b]",
    );
    const el = widget.toDOM();
    expect(el.textContent).toBe("Eq. (1); Eq. (2)");
  });

  it("single-item cluster renders one span with no separators", () => {
    const widget = new ClusteredCrossrefWidget(
      [{ kind: "block", label: "Theorem 1", number: 1 }],
      ["thm-a"],
      "[@thm-a]",
    );
    const el = widget.toDOM();
    expect(el.childNodes.length).toBe(1);
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(1);
    expect(spans[0].getAttribute("data-ref-id")).toBe("thm-a");
  });
});

// Regression (#397): MixedClusterWidget must render per-item spans with
// data-ref-id attributes and separator text nodes, wrapped in parens.
describe("MixedClusterWidget per-item spans", () => {
  it("renders one child span per item with data-ref-id", () => {
    const widget = new MixedClusterWidget(
      [
        { kind: "crossref", id: "eq:alpha", text: "Eq. (1)" },
        { kind: "citation", id: "karger2000", text: "Karger, 2000" },
      ],
      "[@eq:alpha; @karger2000]",
    );
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe(CSS.citation);

    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("eq:alpha");
    expect(spans[0].textContent).toBe("Eq. (1)");
    expect(spans[1].getAttribute("data-ref-id")).toBe("karger2000");
    expect(spans[1].textContent).toBe("Karger, 2000");
  });

  it("wraps content in parentheses", () => {
    const widget = new MixedClusterWidget(
      [
        { kind: "crossref", id: "eq:a", text: "Eq. (1)" },
        { kind: "citation", id: "smith", text: "Smith" },
      ],
      "[@eq:a; @smith]",
    );
    const el = widget.toDOM();
    expect(el.textContent).toBe("(Eq. (1); Smith)");
  });

  it("renders separator text nodes between items", () => {
    const widget = new MixedClusterWidget(
      [
        { kind: "crossref", id: "eq:a", text: "Eq. (1)" },
        { kind: "citation", id: "smith", text: "Smith" },
      ],
      "[@eq:a; @smith]",
    );
    const el = widget.toDOM();
    // childNodes: ["(", span, "; ", span, ")"]
    expect(el.childNodes.length).toBe(5);
    expect(el.childNodes[0].textContent).toBe("(");
    expect(el.childNodes[2].textContent).toBe("; ");
    expect(el.childNodes[4].textContent).toBe(")");
  });

  it("separator text nodes have no data-ref-id", () => {
    const widget = new MixedClusterWidget(
      [
        { kind: "crossref", id: "thm-a", text: "Theorem 1" },
        { kind: "citation", id: "karger", text: "Karger" },
        { kind: "crossref", id: "eq:b", text: "Eq. (2)" },
      ],
      "[@thm-a; @karger; @eq:b]",
    );
    const el = widget.toDOM();
    // childNodes: ["(", span, "; ", span, "; ", span, ")"]
    expect(el.childNodes.length).toBe(7);
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(3);
  });
});
