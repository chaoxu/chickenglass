import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MemoryFileSystem,
  createBlogDemoFileSystem,
  createDemoFileSystem,
} from "./file-manager";

describe("MemoryFileSystem", () => {
  it("reads files that exist", async () => {
    const fs = new MemoryFileSystem({ "test.md": "hello" });
    const content = await fs.readFile("test.md");
    expect(content).toBe("hello");
  });

  it("throws on reading non-existent files", async () => {
    const fs = new MemoryFileSystem();
    await expect(fs.readFile("missing.md")).rejects.toThrow("File not found");
  });

  it("writes to existing files", async () => {
    const fs = new MemoryFileSystem({ "test.md": "old" });
    await fs.writeFile("test.md", "new");
    const content = await fs.readFile("test.md");
    expect(content).toBe("new");
  });

  it("throws on writing to non-existent files", async () => {
    const fs = new MemoryFileSystem();
    await expect(fs.writeFile("missing.md", "data")).rejects.toThrow(
      "File not found",
    );
  });

  it("creates new files", async () => {
    const fs = new MemoryFileSystem();
    await fs.createFile("new.md", "content");
    const content = await fs.readFile("new.md");
    expect(content).toBe("content");
  });

  it("creates files with empty content by default", async () => {
    const fs = new MemoryFileSystem();
    await fs.createFile("empty.md");
    const content = await fs.readFile("empty.md");
    expect(content).toBe("");
  });

  it("throws on creating a file that already exists", async () => {
    const fs = new MemoryFileSystem({ "test.md": "data" });
    await expect(fs.createFile("test.md")).rejects.toThrow(
      "File already exists",
    );
  });

  it("checks file existence", async () => {
    const fs = new MemoryFileSystem({ "test.md": "data" });
    expect(await fs.exists("test.md")).toBe(true);
    expect(await fs.exists("missing.md")).toBe(false);
  });

  it("lists a flat file tree", async () => {
    const fs = new MemoryFileSystem({
      "a.md": "",
      "b.md": "",
    });
    const tree = await fs.listTree();
    expect(tree.isDirectory).toBe(true);
    expect(tree.children).toHaveLength(2);
    expect(tree.children?.[0].name).toBe("a.md");
    expect(tree.children?.[1].name).toBe("b.md");
  });

  it("lists a nested file tree with directories first", async () => {
    const fs = new MemoryFileSystem({
      "z.md": "",
      "chapters/intro.md": "",
      "chapters/bg.md": "",
    });
    const tree = await fs.listTree();
    expect(tree.children).toHaveLength(2);
    // directories first
    expect(tree.children?.[0].name).toBe("chapters");
    expect(tree.children?.[0].isDirectory).toBe(true);
    expect(tree.children?.[0].children).toHaveLength(2);
    // then files
    expect(tree.children?.[1].name).toBe("z.md");
    expect(tree.children?.[1].isDirectory).toBe(false);
  });
});

describe("createDemoFileSystem", () => {
  it("creates a filesystem with sample files", async () => {
    const fs = createDemoFileSystem();
    expect(await fs.exists("main.md")).toBe(true);
    expect(await fs.exists("notes.md")).toBe(true);
    expect(await fs.exists("chapters/introduction.md")).toBe(true);
  });
});

describe("createBlogDemoFileSystem", () => {
  it("includes FORMAT.md from the repo root in the demo project", async () => {
    const fs = createBlogDemoFileSystem();
    expect(await fs.exists("FORMAT.md")).toBe(true);
  });
});

describe("createBlogDemoFileSystem fallback", () => {
  afterEach(() => {
    vi.doUnmock("./demo-blog");
    vi.resetModules();
  });

  it("falls back to the built-in sample project when demo/blog is absent", async () => {
    vi.resetModules();
    vi.doMock("./demo-blog", () => ({
      getBlogFiles: () => ({ "FORMAT.md": "# Format" }),
    }));

    const mod = await import("./file-manager");
    const fs = mod.createBlogDemoFileSystem();

    expect(await fs.exists("FORMAT.md")).toBe(true);
    expect(await fs.exists("main.md")).toBe(true);
    expect(await fs.exists("index.md")).toBe(true);
    expect(await fs.exists("notes.md")).toBe(true);
  });
});

describe("MemoryFileSystem.writeFileBinary", () => {
  it("writes binary data and creates parent directories", async () => {
    const fs = new MemoryFileSystem();
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
    await fs.writeFileBinary("assets/test.png", data);
    expect(await fs.exists("assets/test.png")).toBe(true);
  });

  it("overwrites existing files", async () => {
    const fs = new MemoryFileSystem();
    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6]);
    await fs.writeFileBinary("img/a.png", data1);
    await fs.writeFileBinary("img/a.png", data2);
    // File should still exist (overwritten)
    expect(await fs.exists("img/a.png")).toBe(true);
  });

  it("creates nested directories automatically", async () => {
    const fs = new MemoryFileSystem();
    const data = new Uint8Array([0]);
    await fs.writeFileBinary("a/b/c/test.png", data);
    expect(await fs.exists("a/b/c/test.png")).toBe(true);
  });
});
