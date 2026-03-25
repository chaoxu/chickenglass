/**
 * Tests for the useRecentFiles hook logic.
 *
 * The hook is a thin React wrapper over recent-files.ts.  We test the
 * underlying module functions directly (same code paths the hook calls)
 * because the project does not have @testing-library/react.
 *
 * jsdom in this Vitest environment does not provide a working
 * localStorage, so we mock the utils layer with an in-memory store.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    read: <T>(key: string, fallback: T): T => {
      const raw = data.get(key);
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    write: <T>(key: string, value: T): void => {
      data.set(key, JSON.stringify(value));
    },
  };
});

vi.mock("../lib/utils", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    readLocalStorage: store.read,
    writeLocalStorage: store.write,
  };
});

import {
  getRecentFileEntries,
  getRecentFiles,
  getRecentFolders,
  recordRecentFile,
  recordRecentFolder,
  removeRecentFile,
  removeRecentEntry,
  clearRecentFiles,
  clearRecentFolders,
} from "../recent-files";

beforeEach(() => {
  store.data.clear();
});

// ── addRecentFile ──────────────────────────────────────────────────

describe("addRecentFile (recordRecentFile)", () => {
  it("records a single file", () => {
    recordRecentFile("/a.md");
    expect(getRecentFiles()).toEqual(["/a.md"]);
  });

  it("puts the most-recently-added file first", () => {
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

    expect(getRecentFiles("/projects/a")).toEqual([
      "/projects/a/notes.md",
      "/projects/a/index.md",
    ]);
    expect(getRecentFiles("/projects/b")).toEqual(["/projects/b/index.md"]);
    expect(getRecentFileEntries()).toHaveLength(3);
  });
});

// ── addRecentFolder ────────────────────────────────────────────────

describe("addRecentFolder (recordRecentFolder)", () => {
  it("records a single folder", () => {
    recordRecentFolder("/docs");
    expect(getRecentFolders()).toEqual(["/docs"]);
  });

  it("puts the most-recently-added folder first", () => {
    recordRecentFolder("/a");
    recordRecentFolder("/b");
    expect(getRecentFolders()).toEqual(["/b", "/a"]);
  });

  it("moves an existing entry to the front on re-add", () => {
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
});

// ── removeRecent ───────────────────────────────────────────────────

describe("removeRecent (removeRecentEntry)", () => {
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

  it("removes from both lists at once", () => {
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

  it("removes only the current project's recent file entry", () => {
    recordRecentFile("/shared.md", "/projects/a");
    recordRecentFile("/shared.md", "/projects/b");

    removeRecentFile("/shared.md", "/projects/a");

    expect(getRecentFiles("/projects/a")).toEqual([]);
    expect(getRecentFiles("/projects/b")).toEqual(["/shared.md"]);
  });
});

// ── clearFiles / clearFolders ──────────────────────────────────────

describe("clearFiles (clearRecentFiles)", () => {
  it("removes all recent files", () => {
    recordRecentFile("/a.md");
    recordRecentFile("/b.md");
    clearRecentFiles();
    expect(getRecentFiles()).toEqual([]);
  });

  it("does not affect recent folders", () => {
    recordRecentFile("/a.md");
    recordRecentFolder("/docs");
    clearRecentFiles();
    expect(getRecentFolders()).toEqual(["/docs"]);
  });
});

describe("clearFolders (clearRecentFolders)", () => {
  it("removes all recent folders", () => {
    recordRecentFolder("/a");
    recordRecentFolder("/b");
    clearRecentFolders();
    expect(getRecentFolders()).toEqual([]);
  });

  it("does not affect recent files", () => {
    recordRecentFile("/a.md");
    recordRecentFolder("/docs");
    clearRecentFolders();
    expect(getRecentFiles()).toEqual(["/a.md"]);
  });
});

// ── ordering ───────────────────────────────────────────────────────

describe("most-recent-first ordering", () => {
  it("preserves insertion order across interleaved adds", () => {
    recordRecentFile("/x.md");
    recordRecentFile("/y.md");
    recordRecentFile("/z.md");
    recordRecentFile("/y.md"); // promote y back to front
    expect(getRecentFiles()).toEqual(["/y.md", "/z.md", "/x.md"]);
  });

  it("maintains order after removing middle entry", () => {
    recordRecentFile("/a.md");
    recordRecentFile("/b.md");
    recordRecentFile("/c.md");
    removeRecentEntry("/b.md");
    expect(getRecentFiles()).toEqual(["/c.md", "/a.md"]);
  });
});
