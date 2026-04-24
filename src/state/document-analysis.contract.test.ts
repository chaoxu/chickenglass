import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../parser";
import { createEditorState } from "../test-utils";
import {
  documentAnalysisField,
  documentAnalysisFromSnapshot,
  documentSemanticsField,
} from "./document-analysis";

describe("document analysis state contract", () => {
  it("keeps the legacy semantics field alias pointed at the canonical analysis field", () => {
    const state = createEditorState("# Intro {#sec:intro}\n", {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        documentAnalysisField,
      ],
    });
    const snapshot = state.field(documentAnalysisField);

    expect(state.field(documentSemanticsField)).toBe(snapshot);
    expect(documentAnalysisFromSnapshot(snapshot)).toBe(snapshot.analysis);
    expect(snapshot.headingByFrom.get(0)).toMatchObject({
      id: "sec:intro",
      text: "Intro",
    });
  });

  it("publishes the shared semantic slices needed by renderers and crossrefs", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "$$x^2$$ {#eq:one}",
      "",
      "See @sec:intro and [@eq:one].",
      "",
      "[^n]: note",
    ].join("\n");
    const state = createEditorState(doc, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        documentAnalysisField,
      ],
    });
    const snapshot = state.field(documentAnalysisField);

    expect(snapshot.headings).toHaveLength(1);
    expect(snapshot.equationById.get("eq:one")).toMatchObject({ number: 1 });
    expect(snapshot.referenceIndex.get("sec:intro")).toMatchObject({
      targetKind: "heading",
    });
    expect(snapshot.referenceIndex.get("eq:one")).toMatchObject({
      targetKind: "equation",
    });
    expect(snapshot.footnotes.defs.get("n")?.content).toBe("note");
  });
});
