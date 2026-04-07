import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment } from "@codemirror/state";
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
import {
  includeRegionsField,
  setIncludeRegionsEffect,
  type IncludeRegionState,
} from "../lib/include-regions";
import { createTestView } from "../test-utils";
import {
  _includeLabelViewPluginForTest,
  includeLabelPlugin,
} from "./include-label";

interface IncludeLabelPluginValue {
  decorations: DecorationSet;
}

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createView(
  doc: string,
  cursorPos = 0,
  includeRegions: readonly IncludeRegionState[] = [],
): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
      includeRegionsField,
      includeLabelPlugin,
    ],
  });
  if (includeRegions.length > 0) {
    view.dispatch({ effects: setIncludeRegionsEffect.of(includeRegions) });
  }
  return view;
}

function getIncludePlugin(v: EditorView): IncludeLabelPluginValue {
  const plugin = v.plugin(
    _includeLabelViewPluginForTest as unknown as ViewPlugin<IncludeLabelPluginValue>,
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
      selection: { anchor: from },
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

  it("uses expanded-document include regions when source blocks are no longer present", () => {
    const doc = [
      "Preface",
      "",
      "# Included",
      "",
      "Body paragraph.",
      "",
      "Coda",
    ].join("\n");
    const includeStart = doc.indexOf("# Included");
    const includeEnd = doc.indexOf("\n\nCoda");
    const v = createView(doc, includeStart, [{
      from: includeStart,
      to: includeEnd,
      file: "chapters/included.md",
    }]);

    expect(getActiveLabelTexts(v)).toEqual(["included.md"]);

    v.dispatch({
      changes: {
        from: 0,
        insert: "Intro\n",
      },
    });

    expect(getActiveLabelTexts(v)).toEqual(["included.md"]);
  });

  it("restores include labels after the render compartment is removed and re-added", () => {
    const renderCompartment = new Compartment();
    const doc = [
      "Preface",
      "",
      "# Included",
      "",
      "Body paragraph.",
      "",
      "Coda",
    ].join("\n");
    const includeStart = doc.indexOf("# Included");
    const includeEnd = doc.indexOf("\n\nCoda");
    view = createTestView(doc, {
      cursorPos: includeStart,
      extensions: [
        markdown({ extensions: markdownExtensions }),
        documentAnalysisField,
        includeRegionsField,
        renderCompartment.of(includeLabelPlugin),
      ],
    });
    const v = view;

    v.dispatch({
      effects: setIncludeRegionsEffect.of([{
        from: includeStart,
        to: includeEnd,
        file: "chapters/included.md",
      }]),
    });

    expect(getActiveLabelTexts(v)).toEqual(["included.md"]);

    v.dispatch({ effects: renderCompartment.reconfigure([]) });
    expect(v.state.field(includeRegionsField)).toEqual([{
      from: includeStart,
      to: includeEnd,
      file: "chapters/included.md",
    }]);
    expect(getActiveLabelTexts(v)).toEqual([]);

    v.dispatch({ effects: renderCompartment.reconfigure(includeLabelPlugin) });

    expect(v.state.field(includeRegionsField)).toEqual([{
      from: includeStart,
      to: includeEnd,
      file: "chapters/included.md",
    }]);
    expect(getActiveLabelTexts(v)).toEqual(["included.md"]);
  });
});
