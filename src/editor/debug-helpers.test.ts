import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import { createDebugHelpers } from "./debug-helpers";
import { getDebugSnapshot } from "./debug-snapshot";
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
  forceParsing(view, view.state.doc.length, 5000);
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
  it("keeps the debug lane off by default and toggles it per editor instance", () => {
    const first = createMountedEditor();
    const second = createMountedEditor();
    const firstHelpers = createDebugHelpers(first);
    const secondHelpers = createDebugHelpers(second);

    expect(firstHelpers.debugLaneEnabled()).toBe(false);
    expect(secondHelpers.debugLaneEnabled()).toBe(false);

    expect(firstHelpers.toggleDebugLane()).toBe(true);
    expect(firstHelpers.debugLaneEnabled()).toBe(true);
    expect(secondHelpers.debugLaneEnabled()).toBe(false);

    expect(firstHelpers.toggleDebugLane()).toBe(false);
    expect(firstHelpers.debugLaneEnabled()).toBe(false);
  });

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

  it("uses the shared debug snapshot for dump data", () => {
    const view = createMountedEditor(
      [
        "::: {.theorem} Shared Snapshot",
        "Statement.",
        ":::",
      ].join("\n"),
    );

    const helpers = createDebugHelpers(view);
    const snapshot = getDebugSnapshot(view);
    const dump = helpers.dump();

    expect(dump.divs).toEqual(snapshot.divs);
    expect(dump.fences).toEqual(snapshot.fences);
    expect(dump.cursorLine).toBe(snapshot.cursorLine);
    expect(dump.focused).toBe(snapshot.focused);
    expect(dump.semantics).toEqual(snapshot.semantics);
    expect(dump.structure).toEqual(snapshot.structure);
    expect(dump.render).toEqual(snapshot.render);
    expect(dump.motionGuards).toEqual(snapshot.motionGuards);
    expect(dump.timeline).toEqual(snapshot.timeline);
  });

  it("captures the visible render state snapshot", () => {
    const view = createMountedEditor(
      [
        "::: {.theorem} Render Snapshot",
        "Statement with $x^2$.",
        ":::",
        "",
        "$$",
        "x",
        "$$",
      ].join("\n"),
    );

    const helpers = createDebugHelpers(view);
    const render = helpers.renderState();

    expect(render).toHaveProperty("renderedBlockHeaders");
    expect(render).toHaveProperty("inlineMath");
    expect(render).toHaveProperty("displayMath");
    expect(render).toHaveProperty("citations");
    expect(render).toHaveProperty("crossrefs");
    expect(render).toHaveProperty("tables");
    expect(render).toHaveProperty("figures");
    expect(Array.isArray(render.visibleRawFencedOpeners)).toBe(true);
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
