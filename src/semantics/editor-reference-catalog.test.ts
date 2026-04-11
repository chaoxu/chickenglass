import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../parser";
import { documentAnalysisField } from "../state/document-analysis";
import { getDocumentAnalysisOrRecompute } from "./editor-reference-catalog";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
    ],
  });
}

describe("getDocumentAnalysisOrRecompute", () => {
  it("reuses the cached documentAnalysisField when present", () => {
    const state = createState([
      "# Intro {#sec:intro}",
      "",
      "See [@sec:intro] and $x$.",
    ].join("\n"));

    expect(getDocumentAnalysisOrRecompute(state)).toBe(
      state.field(documentAnalysisField),
    );
  });
});
