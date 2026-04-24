import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriCore = vi.hoisted(() => ({
  invokeTauriCommandRaw: vi.fn(),
}));

vi.mock("./core", () => ({
  invokeTauriCommandRaw: tauriCore.invokeTauriCommandRaw,
}));

import {
  deleteHotExitBackupCommand,
  listHotExitBackupsCommand,
  readHotExitBackupCommand,
  writeHotExitBackupCommand,
} from "./recovery";

describe("hot-exit recovery Tauri commands", () => {
  beforeEach(() => {
    tauriCore.invokeTauriCommandRaw.mockReset();
  });

  it("maps write arguments to the persisted backup payload", async () => {
    const summary = {
      bytes: 512,
      contentHash: "content-hash",
      id: "backup-id",
      name: "main.md",
      path: "notes/main.md",
      projectKey: "project-key",
      projectRoot: "/project",
      updatedAt: 100,
    };
    tauriCore.invokeTauriCommandRaw.mockResolvedValue(summary);

    await expect(writeHotExitBackupCommand(
      "/project",
      "notes/main.md",
      "main.md",
      "# Draft\n",
      "baseline-hash",
    )).resolves.toBe(summary);

    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenCalledWith(
      "write_hot_exit_backup",
      {
        baselineHash: "baseline-hash",
        content: "# Draft\n",
        name: "main.md",
        path: "notes/main.md",
        projectRoot: "/project",
      },
    );
  });

  it("maps read, list, and delete arguments and preserves missing-backup null", async () => {
    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce([]);
    await expect(listHotExitBackupsCommand("/project")).resolves.toEqual([]);
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "list_hot_exit_backups",
      { projectRoot: "/project" },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce(null);
    await expect(readHotExitBackupCommand("/project", "missing.md")).resolves.toBeNull();
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "read_hot_exit_backup",
      {
        path: "missing.md",
        projectRoot: "/project",
      },
    );

    tauriCore.invokeTauriCommandRaw.mockResolvedValueOnce(undefined);
    await deleteHotExitBackupCommand("/project", "notes/main.md");
    expect(tauriCore.invokeTauriCommandRaw).toHaveBeenLastCalledWith(
      "delete_hot_exit_backup",
      {
        path: "notes/main.md",
        projectRoot: "/project",
      },
    );
  });
});
