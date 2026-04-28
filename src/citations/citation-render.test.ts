import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { type CslJsonItem } from "./bibtex-parser";
import { createTestView, makeBibStore } from "../test-utils";
import { CslProcessor } from "./csl-processor";
import { referenceRenderPlugin } from "../render/reference-render";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { documentSemanticsField } from "../state/document-analysis";

const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
};

const stein: CslJsonItem = {
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
};

const store = makeBibStore([karger, stein]);

describe("referenceRenderPlugin citation integration", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function createRefView(doc: string, cursorPos?: number): EditorView {
    const v = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), documentSemanticsField, bibDataField, referenceRenderPlugin],
    });
    v.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: new CslProcessor([karger, stein]) }) });
    return v;
  }

  it("creates a view with the plugin without errors", () => {
    view = createRefView("See [@karger2000] for details.");
    expect(view.state.doc.toString()).toBe("See [@karger2000] for details.");
  });

  it("handles document with no citations", () => {
    view = createRefView("No citations here.");
    expect(view.state.doc.toString()).toBe("No citations here.");
  });

  it("handles empty document", () => {
    view = createRefView("");
    expect(view.state.doc.toString()).toBe("");
  });

  it("handles multiple citations in one document", () => {
    const doc = "See [@karger2000] and [@stein2001].";
    view = createRefView(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("handles cursor at citation position", () => {
    view = createRefView("See [@karger2000] for details.", 5);
    expect(view.state.doc.toString()).toContain("[@karger2000]");
  });

  describe("negative / edge-case", () => {
    it("handles citation with unknown id gracefully", () => {
      view = createRefView("See [@unknown9999].");
      expect(view.state.doc.toString()).toBe("See [@unknown9999].");
    });

    it("handles narrative citation at document start", () => {
      view = createRefView("@karger2000 showed this.", 0);
      expect(view.state.doc.toString()).toContain("@karger2000");
    });

    it("handles document with only punctuation", () => {
      view = createRefView("..., --- !!!");
      expect(view.state.doc.toString()).toBe("..., --- !!!");
    });
  });
});
