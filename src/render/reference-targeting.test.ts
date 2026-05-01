import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontmatterField } from "../state/frontmatter-state";
import { equationLabelExtension } from "../parser/equation-label";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { documentSemanticsField } from "../state/document-analysis";
import { CrossrefWidget } from "./crossref-render";
import { findRenderedReference } from "./reference-targeting";
import { createTestView } from "../test-utils";

function createReferenceView(doc: string): EditorView {
  return createTestView(doc, {
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      documentSemanticsField,
    ],
  });
}

describe("findRenderedReference", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("resolves the hovered reference from the widget source range without scanning references", () => {
    view = createReferenceView([
      "::: {.theorem #thm:main}",
      "Statement.",
      ":::",
      "",
      "See [@thm:main].",
    ].join("\n"));

    const analysis = view.state.field(documentSemanticsField);
    const ref = analysis.references.find((candidate) => candidate.ids.includes("thm:main"));
    expect(ref).toBeDefined();
    if (!ref) {
      throw new Error("expected reference semantics for thm:main");
    }

    const widget = new CrossrefWidget(
      { kind: "block", label: "Theorem 1", number: 1 },
      "[@thm:main]",
    );
    widget.useLiveSourceRange = false;
    widget.updateSourceRange(ref.from, ref.to);
    const widgetEl = widget.toDOM(view);

    const linearScanSpy = vi.spyOn(analysis.references, "find").mockImplementation(() => {
      throw new Error("unexpected linear scan");
    });

    const reference = findRenderedReference(view, widgetEl);

    expect(reference).toMatchObject({
      ids: ["thm:main"],
      bracketed: true,
    });
    expect(linearScanSpy).not.toHaveBeenCalled();
  });
});
