import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MemoryFileSystem,
  createBlogDemoFileSystem,
  createDemoFileSystem,
} from "./file-manager";
import { getDemoFiles } from "./demo-files";

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

  it("exists returns true for explicitly created directories", async () => {
    const fs = new MemoryFileSystem();
    await fs.createDirectory("mydir");
    expect(await fs.exists("mydir")).toBe(true);
  });

  it("exists returns true for implicit directories created by file paths", async () => {
    const fs = new MemoryFileSystem({ "a/b/c.md": "content" });
    expect(await fs.exists("a")).toBe(true);
    expect(await fs.exists("a/b")).toBe(true);
  });

  it("exists returns false for nonexistent paths", async () => {
    const fs = new MemoryFileSystem({ "test.md": "data" });
    expect(await fs.exists("nonexistent")).toBe(false);
    expect(await fs.exists("test.md/fake")).toBe(false);
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

  it("lists only immediate children while including implicit directories", async () => {
    const fs = new MemoryFileSystem({
      "chapters/intro.md": "",
      "chapters/notes/todo.md": "",
      "z.md": "",
    });

    await expect(fs.listChildren("")).resolves.toEqual([
      { name: "chapters", path: "chapters", isDirectory: true },
      { name: "z.md", path: "z.md", isDirectory: false },
    ]);

    await expect(fs.listChildren("chapters")).resolves.toEqual([
      { name: "notes", path: "chapters/notes", isDirectory: true },
      { name: "intro.md", path: "chapters/intro.md", isDirectory: false },
    ]);
  });

  it("refreshes cached child listings after structural changes", async () => {
    const fs = new MemoryFileSystem({ "docs/a.md": "" });
    await expect(fs.listChildren("docs")).resolves.toEqual([
      { name: "a.md", path: "docs/a.md", isDirectory: false },
    ]);

    await fs.createFile("docs/b.md");
    await expect(fs.listChildren("docs")).resolves.toEqual([
      { name: "a.md", path: "docs/a.md", isDirectory: false },
      { name: "b.md", path: "docs/b.md", isDirectory: false },
    ]);

    await fs.renameFile("docs/b.md", "docs/c.md");
    await expect(fs.listChildren("docs")).resolves.toEqual([
      { name: "a.md", path: "docs/a.md", isDirectory: false },
      { name: "c.md", path: "docs/c.md", isDirectory: false },
    ]);

    await fs.deleteFile("docs/a.md");
    await expect(fs.listChildren("docs")).resolves.toEqual([
      { name: "c.md", path: "docs/c.md", isDirectory: false },
    ]);
  });

  it("keeps explicit empty directories addressable in cached child listings", async () => {
    const fs = new MemoryFileSystem();
    await fs.createDirectory("docs");
    await expect(fs.listChildren("")).resolves.toEqual([
      { name: "docs", path: "docs", isDirectory: true },
    ]);
    await expect(fs.listChildren("docs")).resolves.toEqual([]);
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
  it("loads the checked-in demo project when it is available", async () => {
    const fs = await createBlogDemoFileSystem();
    const demoFiles = await getDemoFiles();
    const demoContentPath = Object.keys(demoFiles).find((path) => path !== "FORMAT.md");
    expect(await fs.exists("FORMAT.md")).toBe(true);

    if (demoContentPath) {
      expect(await fs.exists(demoContentPath)).toBe(true);
      return;
    }

    expect(await fs.exists("index.md")).toBe(true);
    expect(await fs.exists("main.md")).toBe(true);
  });
});

describe("createBlogDemoFileSystem fallback", () => {
  afterEach(() => {
    vi.doUnmock("./demo-files");
    vi.resetModules();
  });

  it("falls back to the built-in sample project when the demo fixture is absent", async () => {
    vi.resetModules();
    vi.doMock("./demo-files", () => ({
      getDemoFiles: async () => ({ "FORMAT.md": "# Format" }),
    }));

    const mod = await import("./file-manager");
    const fs = await mod.createBlogDemoFileSystem();

    expect(await fs.exists("FORMAT.md")).toBe(true);
    expect(await fs.exists("main.md")).toBe(true);
    expect(await fs.exists("index.md")).toBe(true);
    expect(await fs.exists("notes.md")).toBe(true);
  });
});

describe("MemoryFileSystem.readFileBinary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips binary data through write + read", async () => {
    const fs = new MemoryFileSystem();
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    await fs.writeFileBinary("assets/test.png", data);
    const result = await fs.readFileBinary("assets/test.png");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(data);
  });

  it("throws on reading a non-existent file", async () => {
    const fs = new MemoryFileSystem();
    await expect(fs.readFileBinary("missing.png")).rejects.toThrow(
      "File not found",
    );
  });

  it("preserves all 256 byte values in a round-trip", async () => {
    const fs = new MemoryFileSystem();
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }
    await fs.writeFileBinary("all-bytes.bin", data);
    const result = await fs.readFileBinary("all-bytes.bin");
    expect(result).toEqual(data);
  });

  it("returns UTF-8 bytes for text-backed svg fixture entries", async () => {
    const fs = new MemoryFileSystem();
    fs.replaceAll([
      {
        path: "assets/figure.svg",
        kind: "text",
        content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>x</text></svg>",
      },
    ]);

    const result = await fs.readFileBinary("assets/figure.svg");

    expect(new TextDecoder().decode(result)).toContain("<svg");
    expect(new TextDecoder().decode(result)).toContain("<text>x</text>");
  });

  it("fetches missing demo assets through an encoded demo URL", async () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    vi.stubGlobal("fetch", fetchMock);

    const fs = new MemoryFileSystem();
    const result = await fs.readFileBinary("assets/My Figure 1.png");

    expect(fetchMock).toHaveBeenCalledWith("/demo/assets/My%20Figure%201.png");
    expect(result).toEqual(bytes);
  });

  it("rejects demo asset traversal paths before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const fs = new MemoryFileSystem();
    await expect(fs.readFileBinary("../secret.png")).rejects.toThrow("File not found");
    await expect(fs.readFileBinary("/etc/passwd")).rejects.toThrow("File not found");

    expect(fetchMock).not.toHaveBeenCalled();
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
