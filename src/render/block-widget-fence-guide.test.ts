import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { createMarkdownLanguageExtensions } from "../editor/base-editor-extensions";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentSemanticsField } from "../state/document-analysis";
import { imageUrlField } from "../state/image-url";
import { mathMacrosField } from "../state/math-macros";
import { pdfPreviewField } from "../state/pdf-preview";
import { fenceGuidePlugin } from "./fence-guide";
import { imageRenderPlugin } from "./image-render";
import { mathRenderPlugin } from "./math-render";
import { tableRenderPlugin } from "./table-render";
import { createTestView } from "../test-utils";
import { CSS } from "../constants/css-classes";
import { blockRenderPlugin } from "./plugin-render";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { defaultPlugins } from "../plugins/default-plugins";

let view: EditorView | undefined;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function flushFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number): void => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function createRichView(doc: string, cursorNeedle: string): EditorView {
  const cursorPos = doc.indexOf(cursorNeedle);
  expect(cursorPos).toBeGreaterThanOrEqual(0);
  view = createTestView(doc, {
    cursorPos: cursorPos + 1,
    extensions: [
      ...createMarkdownLanguageExtensions(),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField(defaultPlugins),
      blockCounterField,
      mathMacrosField,
      imageUrlField,
      pdfPreviewField,
      blockRenderPlugin,
      mathRenderPlugin,
      imageRenderPlugin,
      tableRenderPlugin,
      fenceGuidePlugin,
    ],
  });
  return view;
}

function expectFenceGuide(el: Element | null, depth: number): void {
  expect(el).not.toBeNull();
  const htmlEl = el as HTMLElement;
  expect(htmlEl.classList.contains("cf-fence-guide")).toBe(true);
  expect(htmlEl.classList.contains(CSS.fenceDepth(depth))).toBe(true);
}

describe("block widgets inside active fenced divs", () => {
  it("keeps display math on the active theorem fence guide lane", async () => {
    const doc = [
      "::: {.theorem}",
      "Prelude",
      "$$",
      "x^2 + y^2 = z^2",
      "$$",
      ":::",
    ].join("\n");

    const view = createRichView(doc, "Prelude");
    await flushFrames();
    expectFenceGuide(view.dom.querySelector(`.${CSS.mathDisplay}`), 1);
  });

  it("keeps standalone image widgets on the active theorem fence guide lane", async () => {
    const doc = [
      "::: {.theorem}",
      "Prelude",
      "![diagram](https://example.com/diagram.png)",
      ":::",
    ].join("\n");

    const view = createRichView(doc, "Prelude");
    await flushFrames();
    expectFenceGuide(view.dom.querySelector(`.${CSS.imageWrapper}`), 1);
  });

  it("keeps table widgets on the active theorem fence guide lane", async () => {
    const doc = [
      "::: {.theorem}",
      "Prelude",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      ":::",
    ].join("\n");

    const view = createRichView(doc, "Prelude");
    await flushFrames();
    expectFenceGuide(view.dom.querySelector(`.${CSS.tableWidget}`), 1);
  });
});
