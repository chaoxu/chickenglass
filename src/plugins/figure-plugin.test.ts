import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { createPluginRegistryField } from "./plugin-registry";
import { blockCounterField } from "./block-counter";
import { blockRenderPlugin } from "./plugin-render";
import { figurePlugin } from "./figure-plugin";
import { tableBlockPlugin } from "./table-plugin";
import { mathMacrosField } from "../render/render-core";
import { _blockDecorationFieldForTest } from "./plugin-render";
import { createTestView, getDecorationSpecs } from "../test-utils";

const testPlugins = [figurePlugin, tableBlockPlugin];

function createView(doc: string, cursorPos?: number) {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [fencedDiv] }),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
      mathMacrosField,
      blockRenderPlugin,
    ],
  });
}

describe("figure plugin", () => {
  it("registers as a numbered plugin with captionPosition below", () => {
    expect(figurePlugin.name).toBe("figure");
    expect(figurePlugin.numbered).toBe(true);
    expect(figurePlugin.captionPosition).toBe("below");
    expect(figurePlugin.counter).toBe("figure");
  });

  it("renders Figure 1 header", () => {
    const spec = figurePlugin.render({
      type: "figure",
      number: 1,
      id: "fig-1",
    });
    expect(spec.header).toBe("Figure 1");
    expect(spec.className).toContain("cf-block-figure");
  });

  it("applies block decorations to a fenced figure", () => {
    const doc = [
      "::: {.figure #fig-test}",
      "![](image.png)",
      ":::",
    ].join("\n");
    const view = createView(doc, 0);
    const decoSet = view.state.field(_blockDecorationFieldForTest);
    const specs = getDecorationSpecs(decoSet);
    const blockSpecs = specs.filter((s) => typeof s.class === "string" && s.class.includes("cf-block-figure"));
    expect(blockSpecs.length).toBeGreaterThan(0);
    view.destroy();
  });

  it("places caption label on last body line, not opening fence", () => {
    const doc = [
      "::: {.figure #fig-test}",
      "![](image.png)",
      "A caption line.",
      ":::",
    ].join("\n");
    // Cursor on body line — off both fences
    const view = createView(doc, doc.indexOf("!["));
    const decoSet = view.state.field(_blockDecorationFieldForTest);
    const specs = getDecorationSpecs(decoSet);

    // The opening fence should NOT have cf-block-header class (caption is below)
    const openFenceLine = view.state.doc.line(1);
    const headerOnOpen = specs.filter(
      (s) => typeof s.class === "string"
        && s.class.includes("cf-block-header")
        && !s.class.includes("cf-block-header-collapsed"),
    );
    const headerOnOpenFence = headerOnOpen.filter(
      (s) => s.from === openFenceLine.from,
    );
    expect(headerOnOpenFence).toHaveLength(0);

    // The last body line ("A caption line.") should have cf-block-header
    const captionLine = view.state.doc.line(3); // "A caption line."
    const headerOnCaption = headerOnOpen.filter(
      (s) => s.from === captionLine.from,
    );
    expect(headerOnCaption).toHaveLength(1);

    view.destroy();
  });
});

describe("table block plugin", () => {
  it("registers as a numbered plugin with captionPosition below", () => {
    expect(tableBlockPlugin.name).toBe("table");
    expect(tableBlockPlugin.numbered).toBe(true);
    expect(tableBlockPlugin.captionPosition).toBe("below");
    expect(tableBlockPlugin.counter).toBe("table");
  });

  it("renders Table 1 header", () => {
    const spec = tableBlockPlugin.render({
      type: "table",
      number: 1,
      id: "tbl-1",
    });
    expect(spec.header).toBe("Table 1");
    expect(spec.className).toContain("cf-block-table");
  });
});
