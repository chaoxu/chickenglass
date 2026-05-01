import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CSS } from "../constants/css-classes";
import { createPluginView } from "./reference-render-test-utils";


describe("reference render plugin focus-driven reveal", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("reveals source when the cursor enters a reference and rerenders when it leaves", () => {
    const doc = "See [@karger2000] for details.";
    const refStart = doc.indexOf("[@karger2000]");
    view = createPluginView(doc, 0);

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).not.toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.referenceSource}`)).toBeNull();

    view.dispatch({ selection: { anchor: refStart + 3 } });

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.referenceSource}`)).not.toBeNull();

    view.dispatch({ selection: { anchor: 0 } });

    expect(view.contentDOM.querySelector(`.${CSS.referenceSource}`)).toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).not.toBeNull();
  });

  it("removes rendered references when deleting a reference line", () => {
    const doc = [
      "Intro.",
      "See [@karger2000].",
      "Tail.",
    ].join("\n");
    const refLine = "See [@karger2000].\n";
    const refLineStart = doc.indexOf(refLine);
    view = createPluginView(doc, 0);

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).not.toBeNull();

    view.dispatch({
      changes: {
        from: refLineStart,
        to: refLineStart + refLine.length,
        insert: "",
      },
    });

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).toBeNull();
    expect(view.state.doc.toString()).toBe(["Intro.", "Tail."].join("\n"));
  });

  it("removes rendered references when replacing a reference with plain text", () => {
    const doc = "See [@karger2000] for details.";
    const refStart = doc.indexOf("[@karger2000]");
    view = createPluginView(doc, 0);

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).not.toBeNull();

    view.dispatch({
      changes: {
        from: refStart,
        to: refStart + "[@karger2000]".length,
        insert: "plain text",
      },
    });

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).toBeNull();
    expect(view.state.doc.toString()).toBe("See plain text for details.");
  });
});
