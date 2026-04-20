import { describe, expect, it } from "vitest";

import type { FileEntry } from "./file-system";
import { MemoryFileSystem } from "./memory-file-system";
import {
  listAllMarkdownFiles,
  readProjectTextFiles,
} from "./project-file-enumerator";

describe("project file enumeration", () => {
  it("loads markdown paths from shallow directory trees", async () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "docs", path: "docs", isDirectory: true },
        { name: "notes.txt", path: "notes.txt", isDirectory: false },
      ],
    };
    const listChildren = async (path: string): Promise<FileEntry[]> => {
      if (path === "docs") {
        return [
          { name: "intro.md", path: "docs/intro.md", isDirectory: false },
          { name: "asset.png", path: "docs/asset.png", isDirectory: false },
        ];
      }
      return [];
    };

    await expect(listAllMarkdownFiles({ root: tree, listChildren })).resolves.toEqual([
      "docs/intro.md",
    ]);
  });

  it("cancels traversal when the signal is aborted", async () => {
    const controller = new AbortController();
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [{ name: "docs", path: "docs", isDirectory: true }],
    };
    const listChildren = async (): Promise<FileEntry[]> => {
      controller.abort();
      return [{ name: "intro.md", path: "docs/intro.md", isDirectory: false }];
    };

    await expect(listAllMarkdownFiles({
      root: tree,
      listChildren,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads project text files with caller-provided content overrides", async () => {
    const fs = new MemoryFileSystem({
      "current.md": "stale",
      "other.md": "other",
    });
    const files = await readProjectTextFiles(
      fs,
      ["current.md", "other.md"],
      { contentOverrides: new Map([["current.md", "live"]]) },
    );

    expect(files).toEqual([
      { file: "current.md", content: "live" },
      { file: "other.md", content: "other" },
    ]);
  });
});
