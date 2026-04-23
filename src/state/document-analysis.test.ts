import { markdown } from "@codemirror/lang-markdown";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFrontendPerf,
  getFrontendPerfSnapshot,
} from "../lib/perf";
import { createEditorState } from "../test-utils";
import { documentAnalysisField } from "./document-analysis";

describe("documentAnalysisField perf spans", () => {
  beforeEach(() => {
    clearFrontendPerf();
  });

  it("records update and slice merge spans for semantic updates", () => {
    const state = createEditorState("# Alpha\n\nBody\n", {
      extensions: [markdown(), documentAnalysisField],
    });

    clearFrontendPerf();
    const updated = state.update({
      changes: { from: state.doc.length, insert: "\n## Beta\n" },
    }).state;
    void updated.field(documentAnalysisField);

    const spanNames = getFrontendPerfSnapshot().recent.map((record) => record.name);
    expect(spanNames).toContain("cm6.documentAnalysis.update");
    expect(spanNames).toContain("cm6.documentAnalysis.update.sliceMerge");
  });
});
