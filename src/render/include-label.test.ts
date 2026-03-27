import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import {
  type DecorationSet,
  EditorView,
  type ViewPlugin,
} from "@codemirror/view";
import { markdownExtensions } from "../parser";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import { createTestView } from "../test-utils";
import { includeLabelPlugin } from "./include-label";

interface IncludeLabelPluginValue {
  decorations: DecorationSet;
}

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createView(doc: string, cursorPos = 0): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
      includeLabelPlugin,
    ],
  });
  return view;
}

function getIncludePlugin(v: EditorView): IncludeLabelPluginValue {
  const plugin = v.plugin(
    includeLabelPlugin as unknown as ViewPlugin<IncludeLabelPluginValue>,
  );
  expect(plugin).toBeDefined();
  if (!plugin) {
    throw new Error("includeLabelPlugin is not installed");
  }
  return plugin;
}

function getActiveLabelTexts(v: EditorView): string[] {
  return [...v.dom.querySelectorAll(".cf-include-label-active")]
    .map((element) => element.textContent ?? "");
}

describe("includeLabelPlugin", () => {
  it("does not rebuild on unrelated semantic slice changes", () => {
    const doc = [
      "::: {.include}",
      "chapters/intro.md",
      ":::",
      "",
      "Alpha $x$.",
    ].join("\n");
    const cursorPos = doc.indexOf("intro.md");
    const v = createView(doc, cursorPos);
    const beforeAnalysis = v.state.field(documentAnalysisField);
    const beforeDecorations = getIncludePlugin(v).decorations;
    const from = doc.indexOf("$x$") + 1;

    v.dispatch({
      changes: {
        from,
        to: from + 1,
        insert: "y",
      },
    });

    const afterAnalysis = v.state.field(documentAnalysisField);
    expect(afterAnalysis).not.toBe(beforeAnalysis);
    expect(getDocumentAnalysisSliceRevision(afterAnalysis, "includes")).toBe(
      getDocumentAnalysisSliceRevision(beforeAnalysis, "includes"),
    );
    expect(getIncludePlugin(v).decorations).toBe(beforeDecorations);
    expect(getActiveLabelTexts(v)).toEqual(["intro.md"]);
  });

  it("rebuilds when the include slice changes", () => {
    const doc = [
      "::: {.include}",
      "chapters/intro.md",
      ":::",
    ].join("\n");
    const cursorPos = doc.indexOf("intro.md");
    const v = createView(doc, cursorPos);
    const beforeAnalysis = v.state.field(documentAnalysisField);
    const beforeDecorations = getIncludePlugin(v).decorations;
    const from = doc.indexOf("intro.md");

    v.dispatch({
      changes: {
        from,
        to: from + "intro.md".length,
        insert: "proof.md",
      },
    });

    const afterAnalysis = v.state.field(documentAnalysisField);
    expect(getDocumentAnalysisSliceRevision(afterAnalysis, "includes")).toBe(
      getDocumentAnalysisSliceRevision(beforeAnalysis, "includes") + 1,
    );
    expect(getIncludePlugin(v).decorations).not.toBe(beforeDecorations);
    expect(getActiveLabelTexts(v)).toEqual(["proof.md"]);
  });

  it("rebuilds only when selection changes switch the active include", () => {
    const doc = [
      "::: {.include}",
      "chapters/intro.md",
      ":::",
      "",
      "::: {.include}",
      "chapters/proof.md",
      ":::",
      "",
      "Tail paragraph.",
    ].join("\n");
    const firstCursor = doc.indexOf("intro.md");
    const v = createView(doc, firstCursor);

    const beforeDecorations = getIncludePlugin(v).decorations;
    expect(getActiveLabelTexts(v)).toEqual(["intro.md"]);

    v.dispatch({ selection: { anchor: firstCursor + 2 } });
    expect(getIncludePlugin(v).decorations).toBe(beforeDecorations);
    expect(getActiveLabelTexts(v)).toEqual(["intro.md"]);

    const secondCursor = doc.indexOf("proof.md");
    v.dispatch({ selection: { anchor: secondCursor } });
    const secondDecorations = getIncludePlugin(v).decorations;
    expect(secondDecorations).not.toBe(beforeDecorations);
    expect(getActiveLabelTexts(v)).toEqual(["proof.md"]);

    v.dispatch({ selection: { anchor: doc.indexOf("Tail paragraph.") } });
    expect(getIncludePlugin(v).decorations).not.toBe(secondDecorations);
    expect(getActiveLabelTexts(v)).toEqual([]);
  });
});
