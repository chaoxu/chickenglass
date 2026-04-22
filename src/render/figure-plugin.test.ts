import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { frontmatterField } from "../editor/frontmatter-state";
import { fencedDiv } from "../parser/fenced-div";
import { defaultPlugins } from "../plugins/default-plugins";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { createPluginRegistryField } from "../state/plugin-registry";
import { createTestView, getDecorationSpecs } from "../test-utils";
import { _blockDecorationFieldForTest, blockRenderPlugin } from "./plugin-render";

function requireDefaultPlugin(name: string) {
  const plugin = defaultPlugins.find((p) => p.name === name);
  if (!plugin) {
    throw new Error(`Missing default plugin: ${name}`);
  }
  return plugin;
}

const figurePlugin = requireDefaultPlugin("figure");
const tableBlockPlugin = requireDefaultPlugin("table");
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

  it("places caption label below the content, not on the opening fence", () => {
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

    // The caption should render as a below-content widget anchored after the
    // last body line, not as a line decoration on the opening fence.
    const captionLine = view.state.doc.line(3); // "A caption line."
    const captionWidgets = specs.filter((s) => s.widgetClass === "BlockCaptionWidget");
    expect(captionWidgets).toHaveLength(1);
    expect(captionWidgets[0]?.from).toBe(captionLine.to);

    view.destroy();
  });

  it("clicking a rendered caption moves the cursor to the opening-line caption source", () => {
    const doc = `::: {.figure #fig-test title="A caption line."}\n![](image.png)\n:::`;
    const view = createView(doc, doc.indexOf("!["));

    const caption = view.dom.querySelector<HTMLElement>(".cf-block-caption");
    expect(caption).not.toBeNull();
    if (!caption) {
      view.destroy();
      throw new Error("expected rendered figure caption");
    }

    const openLine = view.state.doc.line(1);
    const titleText = "A caption line.";
    const titleFrom = openLine.text.indexOf(titleText) + openLine.from;

    caption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(view.state.selection.main.anchor).toBe(titleFrom);

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
