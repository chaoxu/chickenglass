import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { createDebugHelpers } from "./debug-helpers";
import { createEditor, toggleTreeView } from "./editor";

const mountedViews: EditorView[] = [];

if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() {},
  });
}

function createMountedEditor(doc = "# Test\n"): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = createEditor({ parent, doc });
  mountedViews.push(view);
  return view;
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
  document.body.innerHTML = "";
});

describe("toggleTreeView", () => {
  it("derives tree-view state from each editor instance", () => {
    const first = createMountedEditor();
    const second = createMountedEditor();

    expect(toggleTreeView(first)).toBe(true);
    expect(toggleTreeView(second)).toBe(true);
    expect(toggleTreeView(first)).toBe(false);
    expect(toggleTreeView(second)).toBe(false);
  });
});

describe("createDebugHelpers", () => {
  it("reports closing fences for divs, code blocks, and display math", () => {
    const view = createMountedEditor(
      [
        "::: {.theorem}",
        "Statement.",
        ":::",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "$$",
        "x",
        "$$",
      ].join("\n"),
    );

    const helpers = createDebugHelpers(view);

    expect(helpers.fences().map((fence) => fence.line)).toEqual([3, 7, 11]);
  });
});
