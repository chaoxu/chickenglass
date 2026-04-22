import { afterEach, describe, expect, it, vi } from "vitest";
import katex from "katex";
import type { EditorView } from "@codemirror/view";
import { createMarkdownLanguageExtensions } from "../editor/base-editor-extensions";
import { documentAnalysisField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { createTestView } from "../test-utils";
import { clearKatexHtmlCache, renderKatexToHtml } from "./inline-shared";
import { mathPrewarmPlugin } from "./math-prewarm";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  vi.restoreAllMocks();
  clearKatexHtmlCache();
});

function createMathPrewarmView(doc: string): EditorView {
  view = createTestView(doc, {
    extensions: [
      ...createMarkdownLanguageExtensions(),
      documentAnalysisField,
      mathMacrosField,
      mathPrewarmPlugin,
    ],
  });
  return view;
}

describe("mathPrewarmPlugin", () => {
  it("keeps unrelated KaTeX cache entries during local math edits", () => {
    const doc = "Keep $a$ and edit $b$.";
    const v = createMathPrewarmView(doc);
    clearKatexHtmlCache();

    renderKatexToHtml("a", false, {}, "html");
    const renderSpy = vi.spyOn(katex, "renderToString");
    const editFrom = doc.indexOf("b");

    v.dispatch({
      changes: {
        from: editFrom,
        to: editFrom + 1,
        insert: "c",
      },
    });
    renderKatexToHtml("a", false, {}, "html");

    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("does not prewarm unchanged math on selection-only updates", () => {
    vi.useFakeTimers();
    try {
      const doc = "Keep $a$ and $b$ while moving the cursor.";
      const v = createMathPrewarmView(doc);
      vi.runOnlyPendingTimers();
      clearKatexHtmlCache();
      const renderSpy = vi.spyOn(katex, "renderToString");

      v.dispatch({ selection: { anchor: doc.length } });
      vi.runOnlyPendingTimers();

      expect(renderSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
