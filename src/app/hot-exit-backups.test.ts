import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriRuntime = vi.hoisted(() => ({
  isTauri: vi.fn(),
}));

const recoveryCommands = vi.hoisted(() => ({
  deleteHotExitBackupCommand: vi.fn(),
  listHotExitBackupsCommand: vi.fn(),
  readHotExitBackupCommand: vi.fn(),
  writeHotExitBackupCommand: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  isTauri: tauriRuntime.isTauri,
}));

vi.mock("./tauri-client/recovery", () => recoveryCommands);

import { createHotExitBackupStore } from "./hot-exit-backups";

describe("createHotExitBackupStore", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tauriRuntime.isTauri.mockReturnValue(true);
  });

  it("returns null outside the Tauri runtime", () => {
    tauriRuntime.isTauri.mockReturnValue(false);

    expect(createHotExitBackupStore()).toBeNull();
  });

  it("maps store operations to recovery command arguments", async () => {
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
    recoveryCommands.writeHotExitBackupCommand.mockResolvedValue(summary);
    recoveryCommands.listHotExitBackupsCommand.mockResolvedValue([summary]);
    recoveryCommands.readHotExitBackupCommand.mockResolvedValue({
      ...summary,
      content: "# Draft\n",
      createdAt: 50,
      version: 1,
    });
    recoveryCommands.deleteHotExitBackupCommand.mockResolvedValue(undefined);

    const store = createHotExitBackupStore();
    if (!store) {
      throw new Error("expected Tauri hot-exit backup store");
    }

    await expect(store.writeBackup({
      baselineHash: "baseline-hash",
      content: "# Draft\n",
      name: "main.md",
      path: "notes/main.md",
      projectRoot: "/project",
    })).resolves.toBe(summary);
    expect(recoveryCommands.writeHotExitBackupCommand).toHaveBeenCalledWith(
      "notes/main.md",
      "main.md",
      "# Draft\n",
      "baseline-hash",
    );

    await expect(store.listBackups("/project")).resolves.toEqual([summary]);
    expect(recoveryCommands.listHotExitBackupsCommand).toHaveBeenCalledWith();

    await expect(store.readBackup("/project", "notes/main.md")).resolves.toMatchObject({
      content: "# Draft\n",
      path: "notes/main.md",
      version: 1,
    });
    expect(recoveryCommands.readHotExitBackupCommand).toHaveBeenCalledWith(
      "notes/main.md",
    );

    await store.deleteBackup("/project", "notes/main.md");
    expect(recoveryCommands.deleteHotExitBackupCommand).toHaveBeenCalledWith(
      "notes/main.md",
    );
  });

  it("preserves null reads for missing backups", async () => {
    recoveryCommands.readHotExitBackupCommand.mockResolvedValue(null);
    const store = createHotExitBackupStore();
    if (!store) {
      throw new Error("expected Tauri hot-exit backup store");
    }

    await expect(store.readBackup("/project", "missing.md")).resolves.toBeNull();
  });
});
