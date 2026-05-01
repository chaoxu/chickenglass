import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../lib/types";
import { applyDiagnosticEntryFix, applyDiagnosticFix, buildBibStubAppend } from "./diagnostic-fix";
import type { DiagnosticEntry } from "./diagnostic-types";

function makeStubFs(initial: Record<string, string>): {
  readonly fs: FileSystem;
  readonly files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  const fs: FileSystem = {
    listTree: () => Promise.reject(new Error("not implemented")),
    readFile: (path) => Promise.resolve(files.get(path) ?? ""),
    writeFile: (path, content) => {
      files.set(path, content);
      return Promise.resolve();
    },
    createFile: (path, content) => {
      if (files.has(path)) {
        return Promise.reject(new Error(`exists: ${path}`));
      }
      files.set(path, content ?? "");
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path)),
    renameFile: () => Promise.reject(new Error("not implemented")),
    createDirectory: () => Promise.reject(new Error("not implemented")),
    deleteFile: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
    writeFileBinary: () => Promise.reject(new Error("not implemented")),
    readFileBinary: () => Promise.reject(new Error("not implemented")),
  };
  return { fs, files };
}

describe("buildBibStubAppend", () => {
  it("creates a fresh stub when existing content is empty", () => {
    expect(buildBibStubAppend("foo", "")).toBe(
      "@misc{foo,\n  title = {TODO: title for foo},\n}\n",
    );
  });

  it("appends with a separating newline when existing content lacks trailing newline", () => {
    const out = buildBibStubAppend("foo", "@book{a,}");
    expect(out.startsWith("@book{a,}\n")).toBe(true);
    expect(out).toContain("@misc{foo,");
  });

  it("appends without inserting a blank line when existing content ends with newline", () => {
    expect(buildBibStubAppend("foo", "@book{a,}\n")).toBe(
      "@book{a,}\n@misc{foo,\n  title = {TODO: title for foo},\n}\n",
    );
  });
});

describe("applyDiagnosticFix", () => {
  it("opens the bibliography for an open-bibliography fix", async () => {
    const openFile = vi.fn(() => Promise.resolve());
    const { fs } = makeStubFs({});
    await applyDiagnosticFix(
      { kind: "open-bibliography", bibPath: "refs.bib", label: "Open" },
      { fs, openFile },
    );
    expect(openFile).toHaveBeenCalledWith("refs.bib");
  });

  it("appends a stub to an existing bib file then opens it", async () => {
    const openFile = vi.fn(() => Promise.resolve());
    const { fs, files } = makeStubFs({ "refs.bib": "@book{a,}\n" });
    await applyDiagnosticFix(
      { kind: "insert-bibliography-stub", bibPath: "refs.bib", id: "newkey", label: "Add" },
      { fs, openFile },
    );
    expect(files.get("refs.bib")).toContain("@misc{newkey,");
    expect(files.get("refs.bib")).toContain("@book{a,}");
    expect(openFile).toHaveBeenCalledWith("refs.bib");
  });

  it("creates the bib file with a stub when missing", async () => {
    const openFile = vi.fn(() => Promise.resolve());
    const { fs, files } = makeStubFs({});
    await applyDiagnosticFix(
      { kind: "insert-bibliography-stub", bibPath: "refs.bib", id: "newkey", label: "Add" },
      { fs, openFile },
    );
    expect(files.get("refs.bib")).toBe(
      "@misc{newkey,\n  title = {TODO: title for newkey},\n}\n",
    );
    expect(openFile).toHaveBeenCalledWith("refs.bib");
  });

  it("is a no-op when applyDiagnosticEntryFix receives an entry without a fix", async () => {
    const openFile = vi.fn();
    const { fs } = makeStubFs({});
    const diagnostic: DiagnosticEntry = {
      severity: "warning",
      source: "reference",
      code: "reference.unresolved",
      message: "x",
      from: 0,
      to: 0,
    };
    await applyDiagnosticEntryFix(diagnostic, { fs, openFile });
    expect(openFile).not.toHaveBeenCalled();
  });
});
