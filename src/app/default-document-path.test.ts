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

  it("returns null when signal is aborted during listChildren", async () => {
    const controller = new AbortController();
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

    const result = await findDefaultDocumentPath(tree, listChildren, controller.signal);

    // Should return null because signal was aborted before findFirst could finish
    expect(result).toBeNull();
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

describe("findDefaultDocumentPath lazy traversal", () => {
  it("loads unloaded sibling directories in parallel when no abort signal is used", async () => {
    let resolveA!: (children: FileEntry[]) => void;
    let resolveB!: (children: FileEntry[]) => void;
    const a = new Promise<FileEntry[]>((resolve) => {
      resolveA = resolve;
    });
    const b = new Promise<FileEntry[]>((resolve) => {
      resolveB = resolve;
    });
    const listChildren = vi.fn((path: string): Promise<FileEntry[]> => {
      if (path === "a") return a;
      if (path === "b") return b;
      return Promise.resolve([]);
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

    const result = findDefaultDocumentPath(tree, listChildren);

    await vi.waitFor(() => {
      expect(listChildren).toHaveBeenCalledTimes(2);
    });
    resolveB([{ name: "found.md", path: "b/found.md", isDirectory: false }]);
    resolveA([]);

    await expect(result).resolves.toBe("b/found.md");
  });

  it("does not surface later sibling load failures after an earlier match", async () => {
    let resolveA!: (children: FileEntry[]) => void;
    let rejectB!: (reason: unknown) => void;
    const a = new Promise<FileEntry[]>((resolve) => {
      resolveA = resolve;
    });
    const b = new Promise<FileEntry[]>((_resolve, reject) => {
      rejectB = reject;
    });
    const listChildren = vi.fn((path: string): Promise<FileEntry[]> => {
      if (path === "a") return a;
      if (path === "b") return b;
      return Promise.resolve([]);
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

    const result = findDefaultDocumentPath(tree, listChildren);

    await vi.waitFor(() => {
      expect(listChildren).toHaveBeenCalledTimes(2);
    });
    resolveA([{ name: "found.md", path: "a/found.md", isDirectory: false }]);
    rejectB(new Error("unreachable sibling"));

    await expect(result).resolves.toBe("a/found.md");
  });
});
