import { describe, expect, it, vi } from "vitest";

import { SearchPanel, installSearchKeybinding } from "./search-panel";
import { queryIndex, type DocumentIndex, type FileIndex, type IndexEntry, type IndexQuery } from "../index";
import type { BackgroundIndexer } from "../index";

function makeEntry(
  overrides: Partial<IndexEntry> & { type: string; file: string },
): IndexEntry {
  return {
    content: "",
    position: { from: 0, to: 0 },
    ...overrides,
  };
}

function makeIndex(fileIndices: FileIndex[]): DocumentIndex {
  const files = new Map<string, FileIndex>();
  for (const fi of fileIndices) {
    files.set(fi.file, fi);
  }
  return { files };
}

/** Create a mock BackgroundIndexer that queries a DocumentIndex synchronously. */
function makeMockIndexer(index: DocumentIndex): BackgroundIndexer {
  return {
    query: (query: IndexQuery) => Promise.resolve(queryIndex(index, query)),
    updateFile: () => Promise.resolve(0),
    removeFile: () => Promise.resolve(),
    bulkUpdate: () => Promise.resolve(0),
    resolveLabel: () => Promise.resolve(undefined),
    findReferences: () => Promise.resolve([]),
    getFileIndex: () => Promise.resolve(undefined),
    getAllLabels: () => Promise.resolve([]),
    dispose: () => {},
  } as unknown as BackgroundIndexer;
}

const testIndex = makeIndex([
  {
    file: "chapter1.md",
    entries: [
      makeEntry({
        type: "theorem",
        label: "thm-1",
        number: 1,
        title: "Main Theorem",
        file: "chapter1.md",
        content: "Let x be a number",
      }),
      makeEntry({
        type: "definition",
        label: "def-1",
        number: 1,
        file: "chapter1.md",
        content: "A group is a set",
      }),
      makeEntry({
        type: "equation",
        label: "eq:euler",
        file: "chapter1.md",
        content: "e^{i\\pi} + 1 = 0",
      }),
    ],
    references: [],
  },
  {
    file: "chapter2.md",
    entries: [
      makeEntry({
        type: "theorem",
        label: "thm-2",
        number: 2,
        file: "chapter2.md",
        content: "Every group has an identity",
      }),
      makeEntry({
        type: "proof",
        file: "chapter2.md",
        content: "By definition of group",
      }),
    ],
    references: [],
  },
]);

/** Helper: set indexer, trigger search, and wait for async results. */
async function searchWith(
  panel: SearchPanel,
  index: DocumentIndex,
  opts?: { query?: string; type?: string },
): Promise<void> {
  panel.setIndexer(makeMockIndexer(index));
  panel.show();
  if (opts?.type) panel.setTypeFilter(opts.type);
  if (opts?.query) panel.setQuery(opts.query);
  // Wait for the async query promise to resolve
  await Promise.resolve();
}

describe("SearchPanel", () => {
  it("creates an element with overlay structure", () => {
    const panel = new SearchPanel();
    expect(panel.element).toBeInstanceOf(HTMLElement);
    expect(panel.element.className).toBe("search-overlay");
    expect(panel.element.querySelector(".search-panel")).not.toBeNull();
    expect(panel.element.querySelector(".search-backdrop")).not.toBeNull();
  });

  it("starts hidden", () => {
    const panel = new SearchPanel();
    expect(panel.isVisible()).toBe(false);
    expect(panel.element.style.display).toBe("none");
  });

  it("shows and hides", () => {
    const panel = new SearchPanel();
    panel.show();
    expect(panel.isVisible()).toBe(true);
    expect(panel.element.style.display).toBe("");

    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect(panel.element.style.display).toBe("none");
  });

  it("toggles visibility", () => {
    const panel = new SearchPanel();
    panel.toggle();
    expect(panel.isVisible()).toBe(true);
    panel.toggle();
    expect(panel.isVisible()).toBe(false);
  });

  it("has a search input and type filter", () => {
    const panel = new SearchPanel();
    const input = panel.element.querySelector(".search-input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    const select = panel.element.querySelector(".search-type-filter");
    expect(select).toBeInstanceOf(HTMLSelectElement);
  });

  it("type filter includes all block types", () => {
    const panel = new SearchPanel();
    const select = panel.element.querySelector(
      ".search-type-filter",
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("");
    expect(options).toContain("theorem");
    expect(options).toContain("definition");
    expect(options).toContain("equation");
    expect(options).toContain("proof");
  });

  it("searches by content and shows results", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "group" });

    const items = panel.element.querySelectorAll(".search-result-item");
    // "group" appears in: def-1 content, thm-2 content, proof content
    expect(items.length).toBe(3);
  });

  it("filters by block type", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { type: "theorem" });

    const items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(2);
  });

  it("combines text search with type filter", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "group", type: "theorem" });

    const items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(1);
  });

  it("searches by label with # prefix", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "#thm-1" });

    const items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(1);

    const typeBadge = items[0].querySelector(".search-result-type");
    expect(typeBadge?.textContent).toBe("theorem");
  });

  it("searches by label with colon notation", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "eq:euler" });

    const items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(1);
  });

  it("searches math content", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "e^{i\\pi}" });

    const items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(1);
  });

  it("displays type, number, title, and file in results", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "#thm-1" });

    const item = panel.element.querySelector(".search-result-item");
    expect(item).not.toBeNull();

    const type = item?.querySelector(".search-result-type");
    expect(type?.textContent).toBe("theorem");

    const num = item?.querySelector(".search-result-number");
    expect(num?.textContent).toBe("1");

    const title = item?.querySelector(".search-result-title");
    expect(title?.textContent).toBe("Main Theorem");

    const file = item?.querySelector(".search-result-file");
    expect(file?.textContent).toBe("chapter1.md");
  });

  it("shows status text for empty query", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex);

    const status = panel.element.querySelector(".search-status");
    // With empty query and no type filter, all entries are returned
    // so we expect "5 results"
    expect(status?.textContent).toContain("5 results");
  });

  it("shows no results message", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { query: "nonexistent term xyz" });

    const status = panel.element.querySelector(".search-status");
    expect(status?.textContent).toBe("No results found");
  });

  it("calls result handler and hides on click", async () => {
    const panel = new SearchPanel();
    const handler = vi.fn();
    panel.setResultHandler(handler);
    await searchWith(panel, testIndex, { query: "#thm-1" });

    const item = panel.element.querySelector(
      ".search-result-item",
    ) as HTMLElement;
    item.click();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].label).toBe("thm-1");
    expect(panel.isVisible()).toBe(false);
  });

  it("hides on backdrop click", () => {
    const panel = new SearchPanel();
    panel.show();

    const backdrop = panel.element.querySelector(
      ".search-backdrop",
    ) as HTMLElement;
    backdrop.click();

    expect(panel.isVisible()).toBe(false);
  });

  it("hides on Escape key", () => {
    const panel = new SearchPanel();
    panel.show();

    const panelEl = panel.element.querySelector(".search-panel") as HTMLElement;
    panelEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(panel.isVisible()).toBe(false);
  });

  it("re-executes search when indexer is set while visible", async () => {
    const panel = new SearchPanel();
    panel.show();
    panel.setQuery("group");

    // No results without an indexer
    let items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(0);

    // Set indexer while visible — triggers re-search
    panel.setIndexer(makeMockIndexer(testIndex));
    await Promise.resolve();
    items = panel.element.querySelectorAll(".search-result-item");
    expect(items.length).toBe(3);
  });

  it("does not show number span when entry has no number", async () => {
    const panel = new SearchPanel();
    await searchWith(panel, testIndex, { type: "proof" });

    const item = panel.element.querySelector(".search-result-item");
    const num = item?.querySelector(".search-result-number");
    expect(num).toBeNull();
  });
});

describe("installSearchKeybinding", () => {
  it("toggles panel on Cmd/Ctrl+Shift+F", () => {
    const root = document.createElement("div");
    const panel = new SearchPanel();
    installSearchKeybinding(root, panel);

    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        metaKey: true,
        shiftKey: true,
      }),
    );
    expect(panel.isVisible()).toBe(true);

    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    expect(panel.isVisible()).toBe(false);
  });

  it("returns a cleanup function", () => {
    const root = document.createElement("div");
    const panel = new SearchPanel();
    const cleanup = installSearchKeybinding(root, panel);

    cleanup();

    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        metaKey: true,
        shiftKey: true,
      }),
    );
    expect(panel.isVisible()).toBe(false);
  });
});
