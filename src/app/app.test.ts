import { describe, expect, it, vi } from "vitest";

import { MemoryFileSystem } from "./file-manager";

// Mock BackgroundIndexer to avoid creating a real Web Worker in tests
vi.mock("../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index")>();
  return {
    ...actual,
    BackgroundIndexer: class MockBackgroundIndexer {
      query() {
        return Promise.resolve([]);
      }
      updateFile() {
        return Promise.resolve(0);
      }
      removeFile() {
        return Promise.resolve();
      }
      bulkUpdate() {
        return Promise.resolve(0);
      }
      resolveLabel() {
        return Promise.resolve(undefined);
      }
      findReferences() {
        return Promise.resolve([]);
      }
      getFileIndex() {
        return Promise.resolve(undefined);
      }
      getAllLabels() {
        return Promise.resolve([]);
      }
      dispose() {}
    },
  };
});

// Import App after mocking so it picks up the mock
const { App } = await import("./app");

function makeFs(): MemoryFileSystem {
  return new MemoryFileSystem({
    "main.md": "# Main",
    "notes.md": "# Notes",
  });
}

function makeApp(fs?: MemoryFileSystem): InstanceType<typeof App> {
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
