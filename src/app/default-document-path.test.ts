import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./file-manager";
import { findDefaultDocumentPath } from "./default-document-path";

describe("findDefaultDocumentPath with AbortSignal", () => {
  it("returns null immediately when signal is already aborted", async () => {
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [{ name: "main.md", path: "main.md", isDirectory: false }],
    };
    const controller = new AbortController();
    controller.abort();

    const result = await findDefaultDocumentPath(tree, undefined, controller.signal);
    expect(result).toBeNull();
  });

  it("skips listChildren calls after signal is aborted", async () => {
    const listChildren = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === "a") {
        // Abort during the first listChildren call
        controller.abort();
        return [{ name: "a.md", path: "a/a.md", isDirectory: false }];
      }
      return [{ name: "b.md", path: "b/b.md", isDirectory: false }];
    });

    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "a", path: "a", isDirectory: true, children: undefined },
        { name: "b", path: "b", isDirectory: true, children: undefined },
      ],
    };

    const controller = new AbortController();
    const result = await findDefaultDocumentPath(tree, listChildren, controller.signal);

    // Should return null because signal was aborted after first listChildren
    expect(result).toBeNull();
    // Should NOT have called listChildren for "b" since signal was aborted
    expect(listChildren).toHaveBeenCalledTimes(1);
    expect(listChildren).toHaveBeenCalledWith("a");
  });

  it("does not abort when signal is not provided", async () => {
    const listChildren = vi.fn(async (): Promise<FileEntry[]> => [
      { name: "found.md", path: "sub/found.md", isDirectory: false },
    ]);
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "sub", path: "sub", isDirectory: true, children: undefined },
      ],
    };

    const result = await findDefaultDocumentPath(tree, listChildren);
    expect(result).toBe("sub/found.md");
  });

  it("aborts before recursing into nested directories", async () => {
    const controller = new AbortController();
    const listChildren = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === "a") {
        controller.abort();
        return [
          { name: "nested", path: "a/nested", isDirectory: true, children: undefined },
        ];
      }
      return [{ name: "deep.md", path: "a/nested/deep.md", isDirectory: false }];
    });

    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "a", path: "a", isDirectory: true, children: undefined },
      ],
    };

    const result = await findDefaultDocumentPath(tree, listChildren, controller.signal);

    // Should return null — aborted after loading "a" but before recursing into "a/nested"
    expect(result).toBeNull();
    expect(listChildren).toHaveBeenCalledTimes(1);
  });
});
