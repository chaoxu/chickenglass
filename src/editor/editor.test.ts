import { describe, expect, it } from "vitest";
import { createEditor } from "./editor";

describe("createEditor", () => {
  it("creates an editor view attached to the given parent", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent });

    expect(view.dom.parentElement).toBe(parent);
    expect(view.state.doc.length).toBeGreaterThan(0);

    view.destroy();
  });

  it("uses provided doc content", () => {
    const parent = document.createElement("div");
    const doc = "# Test";
    const view = createEditor({ parent, doc });

    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });
});
