import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriCore = vi.hoisted(() => ({
  invokeTauriCommandRaw: vi.fn(),
}));

vi.mock("./core", () => ({
  invokeTauriCommandRaw: tauriCore.invokeTauriCommandRaw,
}));

import { exportDocumentCommand, checkPandocCommand } from "./export";
import {
  openFolderCommand,
  readFileCommand,
  writeFileIfUnchangedCommand,
} from "./fs";
import {
  unwatchDirectoryCommand,
  watchDirectoryCommand,
} from "./watch";
import {
  deleteHotExitBackupCommand,
  listHotExitBackupsCommand,
  readHotExitBackupCommand,
  writeHotExitBackupCommand,
} from "./recovery";

describe("typed Tauri command clients", () => {
  beforeEach(() => {
    tauriCore.invokeTauriCommandRaw.mockReset();
  });

  it("routes export dependency checks through the shared typed command factory", async () => {
    tauriCore.invokeTauriCommandRaw.mockResolvedValue({
      format: "html",
      ok: true,
      tools: [{ available: true, install_hint: "Install Pandoc.", name: "pandoc" }],
    });

    await expect(checkPandocCommand("html")).resolves.toMatchObject({
      format: "html",
      ok: true,
    });

    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenCalledWith(
      "check_pandoc",
      { format: "html" },
    );
  });

  it("maps export arguments to the backend Pandoc command contract", async () => {
    tauriCore.invokeTauriCommandRaw.mockResolvedValue("/tmp/out.html");

    await expect(exportDocumentCommand(
      "# Title",
      "html",
      "/tmp/out.html",
      "paper.md",
      { bibliography: "refs.bib", template: "template.html" },
    )).resolves.toBe("/tmp/out.html");

    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenCalledWith(
      "export_document",
      {
        bibliography: "refs.bib",
        content: "# Title",
        format: "html",
        outputPath: "/tmp/out.html",
        sourcePath: "paper.md",
        template: "template.html",
      },
    );
  });

  it("maps filesystem commands to typed backend payloads", async () => {
    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce({
      applied: true,
      root: "/canonical/project",
    });
    await expect(openFolderCommand("/project-alias", 5)).resolves.toEqual({
      applied: true,
      root: "/canonical/project",
    });
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "open_folder",
      {
        generation: 5,
        path: "/project-alias",
      },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce("body");
    await expect(readFileCommand("notes.md")).resolves.toBe("body");
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "read_file",
      { path: "notes.md" },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce({ ok: true });
    await writeFileIfUnchangedCommand("notes.md", "updated", "sha256");
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "write_file_if_hash",
      {
        content: "updated",
        expectedHash: "sha256",
        path: "notes.md",
      },
    );
  });

  it("maps watcher commands to generation-scoped backend payloads", async () => {
    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce({
      applied: true,
      root: "/project",
    });

    await expect(watchDirectoryCommand(7, 120)).resolves.toEqual({
      applied: true,
      root: "/project",
    });
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "watch_directory",
      {
        debounceMs: 120,
        generation: 7,
      },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce(true);
    await expect(unwatchDirectoryCommand(7)).resolves.toBe(true);
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "unwatch_directory",
      { generation: 7 },
    );
  });

  it("maps recovery commands to session-scoped backend payloads", async () => {
    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce({ id: "backup-id" });

    await writeHotExitBackupCommand("notes/main.md", "main.md", "# Draft\n", "baseline");
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "write_hot_exit_backup",
      {
        baselineHash: "baseline",
        content: "# Draft\n",
        name: "main.md",
        path: "notes/main.md",
      },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce([]);
    await listHotExitBackupsCommand();
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "list_hot_exit_backups",
      undefined,
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce(null);
    await readHotExitBackupCommand("notes/main.md");
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "read_hot_exit_backup",
      { path: "notes/main.md" },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce(undefined);
    await deleteHotExitBackupCommand("notes/main.md");
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "delete_hot_exit_backup",
      { path: "notes/main.md" },
    );
  });
});
