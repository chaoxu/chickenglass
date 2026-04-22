import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkPandocCommandMock, exportDocumentCommandMock, isTauriMock } = vi.hoisted(() => ({
  checkPandocCommandMock: vi.fn(),
  exportDocumentCommandMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  isTauri: isTauriMock,
}));

vi.mock("./tauri-client/export", () => ({
  checkPandocCommand: checkPandocCommandMock,
  exportDocumentCommand: exportDocumentCommandMock,
}));

import { _preprocessLatexExportForTest, exportDocument } from "./export";

beforeEach(() => {
  isTauriMock.mockReset();
  checkPandocCommandMock.mockReset();
  exportDocumentCommandMock.mockReset();

  isTauriMock.mockReturnValue(true);
  checkPandocCommandMock.mockResolvedValue("pandoc 3.9.0.2");
  exportDocumentCommandMock.mockImplementation(
    async (_content: string, _format: string, outputPath: string) => outputPath,
  );
});

describe("exportDocument", () => {
  it("routes HTML export through the native Pandoc command", async () => {
    const source = "---\ntitle: Paper\n---\n\n# Intro\n\n$$x^2$$ {#eq:x}";

    const outputPath = await exportDocument(source, "html", "notes/main.md");

    expect(outputPath).toBe("notes/main.html");
    expect(checkPandocCommandMock).toHaveBeenCalledOnce();
    expect(exportDocumentCommandMock).toHaveBeenCalledWith(
      source,
      "html",
      "notes/main.html",
      "notes/main.md",
    );
  });

  it("requires the desktop app for HTML export", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(exportDocument("# Intro", "html", "notes/main.md")).rejects.toThrow(
      "Pandoc-backed export is not available in browser mode",
    );

    expect(checkPandocCommandMock).not.toHaveBeenCalled();
    expect(exportDocumentCommandMock).not.toHaveBeenCalled();
  });

  it("wraps missing Pandoc errors before invoking export", async () => {
    checkPandocCommandMock.mockRejectedValue(new Error("ENOENT"));

    await expect(exportDocument("# Intro", "html", "notes/main.md")).rejects.toThrow(
      "Pandoc is not installed or not found in PATH",
    );

    expect(exportDocumentCommandMock).not.toHaveBeenCalled();
  });

  it("keeps LaTeX preprocessing and frontmatter options on LaTeX/PDF export", async () => {
    const source = [
      "---",
      "bibliography: refs/project.bib",
      "latex:",
      "  template: lipics",
      "  bibliography: refs/paper.bib",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---",
      "",
      "\\begin{equation}\\label{eq:x}",
      "x \\in \\R",
      "\\end{equation}",
    ].join("\n");

    await exportDocument(source, "latex", "notes/main.md");

    expect(exportDocumentCommandMock).toHaveBeenCalledOnce();
    const [processed, format, outputPath, sourcePath, options] =
      exportDocumentCommandMock.mock.calls[0] ?? [];
    expect(format).toBe("latex");
    expect(outputPath).toBe("notes/main.tex");
    expect(sourcePath).toBe("notes/main.md");
    expect(options).toEqual({
      bibliography: "refs/paper.bib",
      template: "lipics",
    });
    expect(processed).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(processed).toContain("\\begin{equation}\\label{eq:x}");
  });
});

describe("preprocessLatexExport", () => {
  it("uses the canonical LaTeX preprocessing pipeline for desktop export", async () => {
    const source = [
      "---",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---",
      "",
      "Intro.",
      "",
      "\\begin{equation}\\label{eq:x}",
      "x \\in \\R",
      "\\end{equation}",
    ].join("\n");

    const processed = await _preprocessLatexExportForTest(source, "main.md");

    expect(processed).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(processed).toContain("\\begin{equation}\\label{eq:x}");
    expect(processed).toContain("\\end{equation}");
  });
});
