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
import type { BlockPlugin } from "../plugins/plugin-types";
import { createTestView, makeBlockPlugin } from "../test-utils";
import {
  CrossrefWidget,
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
    expect(el.className).toBe("cf-crossref");
    expect(el.textContent).toBe("Theorem 1");
    expect(el.title).toBe("[@thm-main]");
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
  it("renders with warning style", () => {
    const widget = new UnresolvedRefWidget("[@unknown]");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("cf-crossref-unresolved");
    expect(el.textContent).toBe("[@unknown]");
    expect(el.title).toBe("Unresolved reference");
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
