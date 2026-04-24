import { describe, expect, it } from "vitest";
import type { FileEntry } from "./types";
import {
  buildFileTreeIndex,
  FILE_TREE_ROOT_ITEM_ID,
  flattenVisibleFileEntries,
  getFileParentPath,
  mergeLazyFileTreeChildren,
  replaceFileTreeChildren,
  sortFileEntries,
  sortFileTree,
} from "./file-tree-model";

function file(path: string, children?: FileEntry[]): FileEntry {
  return {
    name: path.split("/").pop() ?? path,
    path,
    isDirectory: Boolean(children),
    children,
  };
}

describe("file-tree model", () => {
  describe("sorting", () => {
    it("sorts directories before files and then by name", () => {
      const docs = file("docs", []);
      const zeta = file("zeta.md");
      const assets = file("assets", []);
      const index = file("index.md");

      expect(sortFileEntries([zeta, docs, index, assets])).toEqual([
        assets,
        docs,
        index,
        zeta,
      ]);
    });

    it("sorts tree children recursively without mutating the input", () => {
      const tree: FileEntry = {
        name: "project",
        path: "",
        isDirectory: true,
        children: [
          file("zeta.md"),
          file("docs", [
            file("docs/z.md"),
            file("docs/a.md"),
          ]),
        ],
      };

      const result = sortFileTree(tree);

      expect(result.children?.map((entry) => entry.path)).toEqual(["docs", "zeta.md"]);
      expect(result.children?.[0].children?.map((entry) => entry.path)).toEqual([
        "docs/a.md",
        "docs/z.md",
      ]);
      expect(tree.children?.map((entry) => entry.path)).toEqual(["zeta.md", "docs"]);
    });
  });

  describe("parent paths", () => {
    it("returns the containing directory path", () => {
      expect(getFileParentPath("docs/deep/proof.md")).toBe("docs/deep");
      expect(getFileParentPath("index.md")).toBe("");
      expect(getFileParentPath("")).toBe("");
    });
  });

  describe("flattening", () => {
    it("includes only open directory descendants", () => {
      const notes = file("docs/notes.md");
      const deepProof = file("docs/deep/proof.md");
      const deepDir = file("docs/deep", [deepProof]);
      const docsDir = file("docs", [notes, deepDir]);
      const indexFile = file("index.md");
      const entries = [docsDir, indexFile];

      expect(flattenVisibleFileEntries(entries, new Set())).toEqual([
        docsDir,
        indexFile,
      ]);

      expect(flattenVisibleFileEntries(entries, new Set(["docs"]))).toEqual([
        docsDir,
        notes,
        deepDir,
        indexFile,
      ]);
    });
  });

  describe("indexing", () => {
    it("indexes nested directory entries", () => {
      const root: FileEntry = {
        name: "project",
        path: "",
        isDirectory: true,
        children: [
          {
            name: "docs",
            path: "docs",
            isDirectory: true,
            children: [
              {
                name: "deep",
                path: "docs/deep",
                isDirectory: true,
                children: [
                  { name: "proof.md", path: "docs/deep/proof.md", isDirectory: false },
                ],
              },
              { name: "notes.md", path: "docs/notes.md", isDirectory: false },
            ],
          },
          { name: "index.md", path: "index.md", isDirectory: false },
        ],
      };

      const { entriesById, childrenById } = buildFileTreeIndex(root);

      expect(entriesById.has("docs")).toBe(true);
      expect(entriesById.has("docs/deep")).toBe(true);
      expect(entriesById.has("docs/deep/proof.md")).toBe(true);
      expect(entriesById.has("docs/notes.md")).toBe(true);
      expect(entriesById.has("index.md")).toBe(true);
      expect(childrenById.get("docs")).toEqual(["docs/deep", "docs/notes.md"]);
      expect(childrenById.get("docs/deep")).toEqual(["docs/deep/proof.md"]);
      expect(childrenById.get("index.md")).toEqual([]);
      expect(childrenById.get("docs/deep/proof.md")).toEqual([]);
    });

    it("handles null roots and unloaded directory children", () => {
      const empty = buildFileTreeIndex(null);
      expect(empty.childrenById.get(FILE_TREE_ROOT_ITEM_ID)).toEqual([]);
      expect(empty.entriesById.size).toBe(1);

      const root: FileEntry = {
        name: "project",
        path: "",
        isDirectory: true,
        children: [
          { name: "docs", path: "docs", isDirectory: true },
          { name: "index.md", path: "index.md", isDirectory: false },
        ],
      };

      const { entriesById, childrenById } = buildFileTreeIndex(root);

      expect(entriesById.has("docs")).toBe(true);
      expect(entriesById.get("docs")?.children).toBeUndefined();
      expect(childrenById.get("docs")).toEqual([]);
      expect(childrenById.get("index.md")).toEqual([]);
    });
  });

  describe("child replacement", () => {
    const root: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: [
            { name: "readme.md", path: "docs/readme.md", isDirectory: false },
            {
              name: "sub",
              path: "docs/sub",
              isDirectory: true,
              children: [{ name: "deep.md", path: "docs/sub/deep.md", isDirectory: false }],
            },
          ],
        },
        { name: "main.md", path: "main.md", isDirectory: false },
      ],
    };

    it("replaces children of the target directory", () => {
      const newChildren: FileEntry[] = [
        { name: "new.md", path: "docs/new.md", isDirectory: false },
      ];
      const result = replaceFileTreeChildren(root, "docs", newChildren);
      expect(result).not.toBe(root);
      expect(result.children?.[0].children).toEqual(newChildren);
    });

    it("preserves already-loaded subtrees in replaced children", () => {
      const newChildren: FileEntry[] = [
        { name: "readme.md", path: "docs/readme.md", isDirectory: false },
        { name: "sub", path: "docs/sub", isDirectory: true },
      ];
      const result = replaceFileTreeChildren(root, "docs", newChildren);
      const sub = result.children?.[0].children?.find((entry) => entry.name === "sub");
      expect(sub?.children).toEqual([
        { name: "deep.md", path: "docs/sub/deep.md", isDirectory: false },
      ]);
    });

    it("returns the same reference when the target directory is not found", () => {
      const result = replaceFileTreeChildren(root, "nonexistent", []);
      expect(result).toBe(root);
    });

    it("handles root directory replacement", () => {
      const newChildren: FileEntry[] = [
        { name: "only.md", path: "only.md", isDirectory: false },
      ];
      const result = replaceFileTreeChildren(root, "", newChildren);
      expect(result.children).toEqual(newChildren);
    });
  });

  describe("lazy child merge", () => {
    it("merges children into unloaded directories", () => {
      const tree: FileEntry = {
        name: "project",
        path: "",
        isDirectory: true,
        children: [
          {
            name: "docs",
            path: "docs",
            isDirectory: true,
            children: [
              { name: "deep", path: "docs/deep", isDirectory: true },
            ],
          },
        ],
      };
      const children: FileEntry[] = [
        { name: "proof.md", path: "docs/deep/proof.md", isDirectory: false },
      ];

      const result = mergeLazyFileTreeChildren(tree, "docs/deep", children);

      expect(result.children?.[0].children?.[0].children).toEqual(children);
    });

    it("skips merge when directory children are already loaded", () => {
      const tree: FileEntry = {
        name: "project",
        path: "",
        isDirectory: true,
        children: [
          {
            name: "docs",
            path: "docs",
            isDirectory: true,
            children: [
              { name: "deep", path: "docs/deep", isDirectory: true, children: [] },
              { name: "notes.md", path: "docs/notes.md", isDirectory: false },
            ],
          },
        ],
      };
      const staleChildren: FileEntry[] = [
        { name: "notes.md", path: "docs/notes.md", isDirectory: false },
      ];

      const result = mergeLazyFileTreeChildren(tree, "docs", staleChildren);

      expect(result).toBe(tree);
    });

    it("returns the same reference when the target directory is not found", () => {
      const tree: FileEntry = {
        name: "project",
        path: "",
        isDirectory: true,
        children: [
          { name: "index.md", path: "index.md", isDirectory: false },
        ],
      };

      const result = mergeLazyFileTreeChildren(tree, "nonexistent", []);

      expect(result).toBe(tree);
    });
  });
});
