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

  it("exposes reverse-scroll-guarded vertical motion", () => {
    const view = createMountedEditor("First\nSecond\nThird\n");
    const helpers = createDebugHelpers(view);

    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    Object.defineProperty(view, "requestMeasure", {
      configurable: true,
      value: (spec?: {
        read?: () => unknown;
        write?: (value: unknown) => void;
      }) => {
        const measured = spec?.read?.();
        spec?.write?.(measured);
      },
    });
    Object.defineProperty(view, "coordsAtPos", {
      configurable: true,
      value: (pos: number) => {
        const line = view.state.doc.lineAt(pos).number;
        const top = (line - 1) * 24;
        return {
          left: 20,
          right: 20,
          top,
          bottom: top + 24,
        };
      },
    });
    Object.defineProperty(view.contentDOM, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        right: 400,
        top: 0,
        bottom: 300,
        width: 400,
        height: 300,
      }),
    });
    for (const line of view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")) {
      line.style.height = "24px";
    }

    expect(helpers.moveVertically("up")).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1);
  });
});
