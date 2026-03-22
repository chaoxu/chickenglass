import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReadModeViewProps } from "./read-mode-view";

// jsdom lacks ResizeObserver — provide a no-op stub.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// Stub heavy dependencies so the component renders without side effects.
vi.mock("../markdown-to-html", () => ({
  markdownToHtml: (content: string) => `<p>${content}</p>`,
}));
vi.mock("../../document-surfaces", () => ({
  renderDocumentFragmentToHtml: () => "",
}));
vi.mock("tex-linebreak2", () => ({
  texLinebreakDOM: () => Promise.resolve(),
  resetDOMJustification: () => {},
}));
vi.mock("../hyphenation", () => ({
  getHyphenator: () => Promise.resolve(() => ""),
  applyHyphensToContainer: () => {},
}));
vi.mock("../perf", () => ({
  measureAsync: (_label: string, fn: () => Promise<void>) => fn(),
  measureSync: (_label: string, fn: () => void) => fn(),
}));

// Must import after mocks are registered.
const { ReadModeView } = await import("./read-mode-view");

describe("ReadModeView scroll restoration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: ReadModeViewProps) {
    act(() => {
      root.render(createElement(ReadModeView, props));
    });
    const el = container.querySelector<HTMLDivElement>(".cf-read-mode-view");
    if (!el) throw new Error("ReadModeView container not found");
    return el;
  }

  it("restores scrollTop when first document renders", () => {
    const el = render({
      content: "# Doc A\nHello",
      frontmatterConfig: {},
      scrollTop: 200,
    });
    expect(el.scrollTop).toBe(200);
  });

  it("resets scroll to 0 when switching to a document with no saved position", () => {
    // Render document A at scroll 300.
    const el = render({
      content: "# Doc A\nHello",
      frontmatterConfig: {},
      scrollTop: 300,
    });
    expect(el.scrollTop).toBe(300);

    // Simulate user scrolling further in the DOM.
    el.scrollTop = 500;

    // Switch to document B with scrollTop 0.
    render({
      content: "# Doc B\nWorld",
      frontmatterConfig: {},
      scrollTop: 0,
    });
    expect(el.scrollTop).toBe(0);
  });

  it("restores saved position when switching documents", () => {
    // Render document A.
    const el = render({
      content: "# Doc A",
      frontmatterConfig: {},
      scrollTop: 100,
    });
    expect(el.scrollTop).toBe(100);

    // Switch to document B with its own saved position.
    render({
      content: "# Doc B",
      frontmatterConfig: {},
      scrollTop: 450,
    });
    expect(el.scrollTop).toBe(450);
  });

  it("resets scroll when scrollTop is undefined", () => {
    const el = render({
      content: "# Doc A",
      frontmatterConfig: {},
      scrollTop: 250,
    });
    expect(el.scrollTop).toBe(250);

    el.scrollTop = 400;

    render({
      content: "# Doc B",
      frontmatterConfig: {},
      // scrollTop omitted (undefined)
    });
    expect(el.scrollTop).toBe(0);
  });

  it("does not duplicate restore within a single render cycle", () => {
    // Render once — scrollTop should be set exactly once.
    const el = render({
      content: "# Doc A",
      frontmatterConfig: {},
      scrollTop: 100,
    });
    expect(el.scrollTop).toBe(100);

    // Manually change scrollTop to simulate user scroll after restore.
    el.scrollTop = 999;

    // Re-render with same content and same scrollTop — should NOT re-restore
    // because didRestoreScroll guards against it within the same document.
    render({
      content: "# Doc A",
      frontmatterConfig: {},
      scrollTop: 100,
    });
    expect(el.scrollTop).toBe(999);
  });
});
