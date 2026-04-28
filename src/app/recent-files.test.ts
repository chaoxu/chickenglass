/**
 * Direct persistence tests for recent-files.ts.
 *
 * These cover the storage helper's localStorage migration, filtering,
 * scoping, removal, and capping rules without routing through the React hook.
 */

import { describe, expect, it } from "vitest";

import {
  clearRecentFiles,
  clearRecentFolders,
  getRecentFileEntries,
  getRecentFiles,
  getRecentFolders,
  recordRecentFile,
  recordRecentFolder,
  removeRecentFile,
  removeRecentEntry,
} from "./recent-files";
import { RECENT_FILES_KEY, RECENT_FOLDERS_KEY } from "../constants";

describe("recordRecentFile", () => {
  it("records a single file without a project root", () => {
    recordRecentFile("/a.md");
    expect(getRecentFiles()).toEqual(["/a.md"]);
  });

  it("puts the most recently added file first", () => {
    recordRecentFile("/a.md");
    recordRecentFile("/b.md");
    recordRecentFile("/c.md");
    expect(getRecentFiles()).toEqual(["/c.md", "/b.md", "/a.md"]);
  });

  it("moves an existing entry to the front on re-add", () => {
    recordRecentFile("/a.md");
    recordRecentFile("/b.md");
    recordRecentFile("/a.md");
    expect(getRecentFiles()).toEqual(["/a.md", "/b.md"]);
  });

  it("caps the list at 10 entries", () => {
    for (let i = 0; i < 12; i++) {
      recordRecentFile(`/file-${i}.md`);
    }
    const files = getRecentFiles();
    expect(files).toHaveLength(10);
    expect(files[0]).toBe("/file-11.md");
    expect(files[9]).toBe("/file-2.md");
  });

  it("scopes recent files by project root", () => {
    recordRecentFile("/projects/a/index.md", "/projects/a");
    recordRecentFile("/projects/b/index.md", "/projects/b");
    recordRecentFile("/projects/a/notes.md", "/projects/a");

    expect(getRecentFileEntries()).toEqual([
      { path: "/projects/a/notes.md", projectRoot: "/projects/a" },
      { path: "/projects/b/index.md", projectRoot: "/projects/b" },
      { path: "/projects/a/index.md", projectRoot: "/projects/a" },
    ]);
    expect(getRecentFileEntries("/projects/a")).toEqual([
      { path: "/projects/a/notes.md", projectRoot: "/projects/a" },
      { path: "/projects/a/index.md", projectRoot: "/projects/a" },
    ]);
    expect(getRecentFiles("/projects/a")).toEqual([
      "/projects/a/notes.md",
      "/projects/a/index.md",
    ]);
    expect(getRecentFiles("/projects/b")).toEqual(["/projects/b/index.md"]);
  });

  it("filters malformed recent-file payloads", () => {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify([
      { path: "/scoped.md", projectRoot: "/projects/a" },
      { path: "/unscoped.md", projectRoot: null },
      "/legacy.md",
      { path: "/implicit-null.md" },
      { path: 123, projectRoot: "/projects/a" },
      null,
    ]));

    expect(getRecentFileEntries()).toEqual([
      { path: "/scoped.md", projectRoot: "/projects/a" },
      { path: "/unscoped.md", projectRoot: null },
    ]);
    expect(getRecentFiles(null)).toEqual(["/unscoped.md"]);
  });

  it("returns an empty file list for non-array stored payloads", () => {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify({ path: "/not-an-array.md" }));

    expect(getRecentFileEntries()).toEqual([]);
    expect(getRecentFiles()).toEqual([]);
  });
});

describe("recordRecentFolder", () => {
  it("records a single folder", () => {
    recordRecentFolder("/docs");
    expect(getRecentFolders()).toEqual(["/docs"]);
  });

  it("puts the most recently added folder first", () => {
    recordRecentFolder("/a");
    recordRecentFolder("/b");
    expect(getRecentFolders()).toEqual(["/b", "/a"]);
  });

  it("moves an existing folder to the front on re-add", () => {
    recordRecentFolder("/a");
    recordRecentFolder("/b");
    recordRecentFolder("/a");
    expect(getRecentFolders()).toEqual(["/a", "/b"]);
  });

  it("caps the list at 5 entries", () => {
    for (let i = 0; i < 7; i++) {
      recordRecentFolder(`/dir-${i}`);
    }
    const folders = getRecentFolders();
    expect(folders).toHaveLength(5);
    expect(folders[0]).toBe("/dir-6");
    expect(folders[4]).toBe("/dir-2");
  });

  it("filters malformed folder entries from storage", () => {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify([
      "/docs",
      42,
      { path: "/wrong-shape" },
      "/notes",
    ]));

    expect(getRecentFolders()).toEqual(["/docs", "/notes"]);
  });
});

describe("removeRecentFile and removeRecentEntry", () => {
  it("removes a path from recent files", () => {
    recordRecentFile("/a.md");
    recordRecentFile("/b.md");
    removeRecentEntry("/a.md");
    expect(getRecentFiles()).toEqual(["/b.md"]);
  });

  it("removes a path from recent folders", () => {
    recordRecentFolder("/docs");
    recordRecentFolder("/notes");
    removeRecentEntry("/docs");
    expect(getRecentFolders()).toEqual(["/notes"]);
  });

  it("removes a shared path from both lists at once", () => {
    const shared = "/projects/thesis";
    recordRecentFile(shared);
    recordRecentFolder(shared);
    removeRecentEntry(shared);
    expect(getRecentFiles()).toEqual([]);
    expect(getRecentFolders()).toEqual([]);
  });

  it("is a no-op when the path is not present", () => {
    recordRecentFile("/a.md");
    removeRecentEntry("/nonexistent");
    expect(getRecentFiles()).toEqual(["/a.md"]);
  });

  it("removes only the matching project-scoped entry", () => {
    recordRecentFile("/shared.md", "/projects/a");
    recordRecentFile("/shared.md", "/projects/b");

    removeRecentFile("/shared.md", "/projects/a");

    expect(getRecentFiles("/projects/a")).toEqual([]);
    expect(getRecentFiles("/projects/b")).toEqual(["/shared.md"]);
  });

  it("removes matching paths across all projects when no project root is provided", () => {
    recordRecentFile("/shared.md", "/projects/a");
    recordRecentFile("/shared.md", "/projects/b");

    removeRecentFile("/shared.md");

    expect(getRecentFiles("/projects/a")).toEqual([]);
    expect(getRecentFiles("/projects/b")).toEqual([]);
  });
});

describe("clearRecentFiles and clearRecentFolders", () => {
  it("clears recent files without affecting recent folders", () => {
    recordRecentFile("/a.md");
    recordRecentFolder("/docs");
    clearRecentFiles();

    expect(getRecentFiles()).toEqual([]);
    expect(getRecentFolders()).toEqual(["/docs"]);
  });

  it("clears recent folders without affecting recent files", () => {
    recordRecentFile("/a.md");
    recordRecentFolder("/docs");
    clearRecentFolders();

    expect(getRecentFiles()).toEqual(["/a.md"]);
    expect(getRecentFolders()).toEqual([]);
  });
});

describe("recent-file ordering", () => {
  it("preserves insertion order across interleaved adds", () => {
    recordRecentFile("/x.md");
    recordRecentFile("/y.md");
    recordRecentFile("/z.md");
    recordRecentFile("/y.md");
    expect(getRecentFiles()).toEqual(["/y.md", "/z.md", "/x.md"]);
  });

  it("maintains order after removing a middle entry", () => {
    recordRecentFile("/a.md");
    recordRecentFile("/b.md");
    recordRecentFile("/c.md");
    removeRecentEntry("/b.md");
    expect(getRecentFiles()).toEqual(["/c.md", "/a.md"]);
  });
});
