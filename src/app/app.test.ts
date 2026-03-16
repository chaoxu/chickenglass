import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "./file-manager";
import { App } from "./app";

function makeFs(): MemoryFileSystem {
  return new MemoryFileSystem({
    "main.md": "# Main",
    "notes.md": "# Notes",
  });
}

function makeApp(fs?: MemoryFileSystem): App {
  const root = document.createElement("div");
  return new App({ root, fs: fs ?? makeFs() });
}

describe("App", () => {
  it("creates the DOM structure", () => {
    const root = document.createElement("div");
    new App({ root, fs: makeFs() });

    expect(root.querySelector(".tab-bar")).not.toBeNull();
    expect(root.querySelector(".sidebar")).not.toBeNull();
    expect(root.querySelector(".app-editor")).not.toBeNull();
  });

  it("initializes and renders the file tree", async () => {
    const app = makeApp();
    await app.init();

    const sidebar = app.getSidebar();
    const items =
      sidebar.fileTree.element.querySelectorAll(".file-tree-item");
    expect(items.length).toBeGreaterThan(0);
  });

  it("opens a file and creates a tab", async () => {
    const app = makeApp();
    await app.init();

    await app.openFile("main.md");
    const tabBar = app.getTabBar();
    expect(tabBar.hasTab("main.md")).toBe(true);
    expect(tabBar.getActiveTab()).toBe("main.md");
  });

  it("does not duplicate tabs on re-open", async () => {
    const app = makeApp();
    await app.init();

    await app.openFile("main.md");
    await app.openFile("main.md");
    const tabBar = app.getTabBar();
    expect(tabBar.getOpenTabs()).toHaveLength(1);
  });

  it("opens multiple files in tabs", async () => {
    const app = makeApp();
    await app.init();

    await app.openFile("main.md");
    await app.openFile("notes.md");
    const tabBar = app.getTabBar();
    expect(tabBar.getOpenTabs()).toHaveLength(2);
    expect(tabBar.getActiveTab()).toBe("notes.md");
  });

  it("saves the active file", async () => {
    const fs = makeFs();
    const app = makeApp(fs);
    await app.init();

    await app.openFile("main.md");
    // Simulate content in the buffer by saving directly
    await app.saveActiveFile();
    const content = await fs.readFile("main.md");
    expect(content).toBe("# Main");
  });

  it("creates a new file and opens it", async () => {
    const fs = makeFs();
    const app = makeApp(fs);
    await app.init();

    await app.createFile("new.md");
    expect(await fs.exists("new.md")).toBe(true);
    const tabBar = app.getTabBar();
    expect(tabBar.hasTab("new.md")).toBe(true);
  });

  it("opens the initial file on init", async () => {
    const app = makeApp();
    await app.init("main.md");

    const tabBar = app.getTabBar();
    expect(tabBar.hasTab("main.md")).toBe(true);
    expect(tabBar.getActiveTab()).toBe("main.md");
  });

  it("mounts the search panel overlay in the DOM", () => {
    const root = document.createElement("div");
    new App({ root, fs: makeFs() });

    expect(root.querySelector(".search-overlay")).not.toBeNull();
  });

  it("search panel starts hidden", () => {
    const app = makeApp();
    const searchPanel = app.getSearchPanel();

    expect(searchPanel.isVisible()).toBe(false);
  });

  it("toggles search panel with Cmd/Ctrl+Shift+F", () => {
    const root = document.createElement("div");
    const app = new App({ root, fs: makeFs() });

    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        metaKey: true,
        shiftKey: true,
      }),
    );

    expect(app.getSearchPanel().isVisible()).toBe(true);

    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        metaKey: true,
        shiftKey: true,
      }),
    );

    expect(app.getSearchPanel().isVisible()).toBe(false);
  });

  it("opens a file when a search result is clicked", async () => {
    const app = makeApp();
    await app.init();
    const searchPanel = app.getSearchPanel();

    // Provide an index with an entry pointing to an existing file
    searchPanel.setIndex({
      files: new Map([
        [
          "main.md",
          {
            file: "main.md",
            entries: [
              {
                type: "heading",
                file: "main.md",
                content: "Main",
                position: { from: 0, to: 6 },
              },
            ],
            references: [],
          },
        ],
      ]),
    });

    searchPanel.show();
    searchPanel.setTypeFilter("heading");

    const item = searchPanel.element.querySelector(
      ".search-result-item",
    ) as HTMLElement;
    item.click();

    // The panel auto-hides on click
    expect(searchPanel.isVisible()).toBe(false);

    // openFile is async; wait a microtask for it to complete
    await Promise.resolve();
    expect(app.getTabBar().hasTab("main.md")).toBe(true);
  });

  it("cleans up keybinding on destroy", () => {
    const root = document.createElement("div");
    const app = new App({ root, fs: makeFs() });

    app.destroy();

    // After destroy, the keybinding should no longer toggle the panel
    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        metaKey: true,
        shiftKey: true,
      }),
    );

    expect(app.getSearchPanel().isVisible()).toBe(false);
  });
});
