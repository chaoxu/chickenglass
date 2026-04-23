import { markdown } from "@codemirror/lang-markdown";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFrontendPerf,
  getFrontendPerfSnapshot,
} from "../lib/perf";
import { createEditorState } from "../test-utils";
import {
  documentAnalysisField,
  editorStateTextSource,
} from "./document-analysis";

describe("documentAnalysisField perf spans", () => {
  beforeEach(() => {
    clearFrontendPerf();
  });

  it("records create and syntax-tree spans for initial analysis", () => {
    const state = createEditorState("# Alpha\n\nBody\n", {
      extensions: [markdown(), documentAnalysisField],
    });
    void state.field(documentAnalysisField);

    const spanNames = getFrontendPerfSnapshot().recent.map((record) => record.name);
    expect(spanNames).toContain("cm6.documentAnalysis.create");
    expect(spanNames).toContain("cm6.documentAnalysis.ensureSyntaxTree");
  });

  it("records text materialization after repeated text-source slices", () => {
    const state = createEditorState("# Alpha\n\nBody\n", {
      extensions: [markdown()],
    });
    const source = editorStateTextSource(state);

    for (let i = 0; i < 8; i += 1) {
      source.slice(0, source.length);
    }

    const spanNames = getFrontendPerfSnapshot().recent.map((record) => record.name);
    expect(spanNames).toContain("cm6.documentAnalysis.text.materialize");
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
