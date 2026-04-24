import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./file-manager";
import type { HotExitBackupStore } from "./hot-exit-backups";
import {
  openProjectInCurrentWindow as openProjectInCurrentWindowFlow,
  type OpenProjectInCurrentWindowOptions,
} from "./project-open";

function openProjectInCurrentWindow(
  options: Omit<
    OpenProjectInCurrentWindowOptions,
    "probeProjectRoot"
  > & Partial<Pick<OpenProjectInCurrentWindowOptions, "probeProjectRoot">>,
): Promise<boolean> {
  return openProjectInCurrentWindowFlow({
    probeProjectRoot: vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    })),
    ...options,
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createFileTree(path: string): FileEntry {
  return {
    name: "project",
    path: "",
    isDirectory: true,
    children: [{ name: path, path, isDirectory: false }],
  };
}

function createRecoveryStore(
  overrides?: Partial<HotExitBackupStore>,
): HotExitBackupStore {
  return {
    writeBackup: vi.fn(async () => ({
      bytes: 100,
      contentHash: "hash",
      id: "backup-id",
      name: "draft.md",
      path: "draft.md",
      projectKey: "project",
      projectRoot: "/tmp/project",
      updatedAt: 100,
    })),
    listBackups: vi.fn(async () => []),
    readBackup: vi.fn(async () => null),
    deleteBackup: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("openProjectInCurrentWindow", () => {
  it("invalidates a stale in-flight file open when a newer project switch wins", async () => {
    let latestProjectRequest = 0;
    let latestOpenFileToken = 0;
    const committedPaths: string[] = [];
    const firstOpen = createDeferred<undefined>();
    const emptyTree: FileEntry = { name: "project", path: "", isDirectory: true, children: [] };
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: path === "/tmp/project-a" ? createFileTree("a.md") : emptyTree,
    }));
    const closeCurrentFile = vi.fn(async () => true);
    const openFile = vi.fn(async (path: string) => {
      const token = ++latestOpenFileToken;
      await firstOpen.promise;
      if (token !== latestOpenFileToken) {
        return;
      }
      committedPaths.push(path);
    });

    const firstRequest = openProjectInCurrentWindow({
      projectRoot: "/tmp/project-a",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: () => {
        latestOpenFileToken += 1;
      },
      closeCurrentFile,
      openProjectRoot,
      openFile,
    });
    await Promise.resolve();

    const secondRequest = openProjectInCurrentWindow({
      projectRoot: "/tmp/project-b",
      currentProjectRoot: "/tmp/project-a",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: () => {
        latestOpenFileToken += 1;
      },
      closeCurrentFile,
      openProjectRoot,
      openFile,
    });

    firstOpen.resolve(undefined);

    await expect(firstRequest).resolves.toBe(false);
    await expect(secondRequest).resolves.toBe(true);
    expect(committedPaths).toEqual([]);
  });

  it("opens only the newest project's target document when requests overlap", async () => {
    let latestProjectRequest = 0;
    let latestOpenFileToken = 0;
    const committedPaths: string[] = [];
    const firstOpen = createDeferred<undefined>();
    const secondOpen = createDeferred<undefined>();
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: path === "/tmp/project-a" ? createFileTree("a.md") : createFileTree("b.md"),
    }));
    const closeCurrentFile = vi.fn(async () => true);
    const openFile = vi.fn(async (path: string) => {
      const token = ++latestOpenFileToken;
      if (path === "a.md") {
        await firstOpen.promise;
      } else {
        await secondOpen.promise;
      }
      if (token !== latestOpenFileToken) {
        return;
      }
      committedPaths.push(path);
    });

    const nextRequestId = () => ++latestProjectRequest;
    const isRequestCurrent = (requestId: number) => requestId === latestProjectRequest;
    const cancelPendingOpenFile = () => {
      latestOpenFileToken += 1;
    };

    const firstRequest = openProjectInCurrentWindow({
      projectRoot: "/tmp/project-a",
      currentProjectRoot: "/tmp/original",
      nextRequestId,
      isRequestCurrent,
      cancelPendingOpenFile,
      closeCurrentFile,
      openProjectRoot,
      openFile,
    });
    await Promise.resolve();

    const secondRequest = openProjectInCurrentWindow({
      projectRoot: "/tmp/project-b",
      currentProjectRoot: "/tmp/project-a",
      nextRequestId,
      isRequestCurrent,
      cancelPendingOpenFile,
      closeCurrentFile,
      openProjectRoot,
      openFile,
    });

    firstOpen.resolve(undefined);
    secondOpen.resolve(undefined);

    await expect(firstRequest).resolves.toBe(false);
    await expect(secondRequest).resolves.toBe(true);
    expect(committedPaths).toEqual(["b.md"]);
  });

  it("treats a same-project alias folder open with no initial file as a no-op", async () => {
    let latestProjectRequest = 0;
    const cancelPendingOpenFile = vi.fn();
    const closeCurrentFile = vi.fn(async () => true);
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path === "/tmp/project-alias" ? "/tmp/canonical-project" : path,
      tree: createFileTree("main.md"),
    }));
    const openFile = vi.fn(async () => {});

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/project-alias",
      currentProjectRoot: "/tmp/canonical-project",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile,
      closeCurrentFile,
      openProjectRoot,
      canonicalizeProjectRoot: vi.fn(async () => "/tmp/canonical-project"),
      openFile,
    });

    expect(result).toBe(true);
    expect(cancelPendingOpenFile).toHaveBeenCalledOnce();
    expect(closeCurrentFile).not.toHaveBeenCalled();
    expect(openProjectRoot).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("opens an initial file for a same-project alias without resetting the project", async () => {
    let latestProjectRequest = 0;
    const cancelPendingOpenFile = vi.fn();
    const closeCurrentFile = vi.fn(async () => true);
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    }));
    const openFile = vi.fn(async () => {});

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/project-alias",
      initialPath: "docs/note.md",
      currentProjectRoot: "/tmp/canonical-project",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile,
      closeCurrentFile,
      openProjectRoot,
      canonicalizeProjectRoot: vi.fn(async () => "/tmp/canonical-project"),
      openFile,
    });

    expect(result).toBe(true);
    expect(cancelPendingOpenFile).toHaveBeenCalledOnce();
    expect(closeCurrentFile).not.toHaveBeenCalled();
    expect(openProjectRoot).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith("docs/note.md");
  });

  it("does not close the current file when target project canonicalization fails", async () => {
    let latestProjectRequest = 0;
    const closeCurrentFile = vi.fn(async () => true);
    const openProjectRoot = vi.fn(async () => null);
    const openFile = vi.fn(async () => {});

    await expect(openProjectInCurrentWindow({
      projectRoot: "/tmp/missing-project",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile,
      openProjectRoot,
      canonicalizeProjectRoot: vi.fn(async () => {
        throw new Error("Not a directory: /tmp/missing-project");
      }),
      openFile,
    })).rejects.toThrow("Not a directory: /tmp/missing-project");

    expect(openProjectRoot).not.toHaveBeenCalled();
    expect(closeCurrentFile).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("does not close the current file when probing the target project returns null", async () => {
    let latestProjectRequest = 0;
    const closeCurrentFile = vi.fn(async () => true);
    const probeProjectRoot = vi.fn(async () => null);
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    }));
    const openFile = vi.fn(async () => {});

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/missing-project",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile,
      probeProjectRoot,
      openProjectRoot,
      openFile,
    });

    expect(result).toBe(false);
    expect(probeProjectRoot).toHaveBeenCalledWith("/tmp/missing-project");
    expect(openProjectRoot).not.toHaveBeenCalled();
    expect(closeCurrentFile).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("does not close the current file when probing the target project rejects", async () => {
    let latestProjectRequest = 0;
    const closeCurrentFile = vi.fn(async () => true);
    const probeProjectRoot = vi.fn(async (path: string) => {
      if (path === "/tmp/missing-project") {
        throw new Error("Not a directory: /tmp/missing-project");
      }
      return {
        projectRoot: path,
        tree: createFileTree("main.md"),
      };
    });
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    }));
    const openFile = vi.fn(async () => {});

    await expect(openProjectInCurrentWindow({
      projectRoot: "/tmp/missing-project",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile,
      probeProjectRoot,
      openProjectRoot,
      openFile,
    })).rejects.toThrow("Not a directory: /tmp/missing-project");

    expect(probeProjectRoot).toHaveBeenCalledWith("/tmp/missing-project");
    expect(openProjectRoot).not.toHaveBeenCalled();
    expect(closeCurrentFile).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("probes the target root before closing the current file, then commits the switch", async () => {
    let latestProjectRequest = 0;
    const calls: string[] = [];
    const targetTree = createFileTree("main.md");
    const probeProjectRoot = vi.fn(async (path: string) => {
      calls.push(`probe-project-root:${path}`);
      return {
        projectRoot: path,
        tree: targetTree,
      };
    });
    const closeCurrentFile = vi.fn(async () => {
      calls.push("close-current-file");
      return true;
    });
    const openProjectRoot = vi.fn(async (path: string, preloaded?: unknown) => {
      calls.push(`open-project-root:${path}`);
      expect(preloaded).toEqual({ projectRoot: "/tmp/next-project", tree: targetTree });
      return {
        projectRoot: path,
        tree: targetTree,
      };
    });
    const openFile = vi.fn(async (path: string) => {
      calls.push(`open-file:${path}`);
    });

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/next-project",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile,
      probeProjectRoot,
      openProjectRoot,
      canonicalizeProjectRoot: vi.fn(async () => "/tmp/next-project"),
      openFile,
    });

    expect(result).toBe(true);
    expect(calls).toEqual([
      "probe-project-root:/tmp/next-project",
      "close-current-file",
      "open-project-root:/tmp/next-project",
      "open-file:main.md",
    ]);
  });

  it("falls back to the default document when the explicit target cannot open", async () => {
    let latestProjectRequest = 0;
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    }));
    const closeCurrentFile = vi.fn(async () => true);
    const openFile = vi.fn(async (path: string) => {
      if (path === "missing.md") {
        throw new Error("missing target");
      }
    });

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/next-project",
      initialPath: "missing.md",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile,
      openProjectRoot,
      openFile,
    });

    expect(result).toBe(true);
    expect(openFile).toHaveBeenNthCalledWith(1, "missing.md");
    expect(openFile).toHaveBeenNthCalledWith(2, "main.md");
  });

  it("restores a hot-exit backup before explicit project-switch document activation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    let latestProjectRequest = 0;
    const recoveryStore = createRecoveryStore({
      listBackups: vi.fn(async () => [{
        bytes: 100,
        contentHash: "hash",
        id: "backup-id",
        name: "draft.md",
        path: "draft.md",
        projectKey: "project",
        projectRoot: "/tmp/next-project",
        updatedAt: 100,
      }]),
      readBackup: vi.fn(async () => ({
        version: 1 as const,
        id: "backup-id",
        projectRoot: "/tmp/next-project",
        projectKey: "project",
        path: "draft.md",
        name: "draft.md",
        content: "unsaved draft",
        contentHash: "hash",
        baselineHash: "baseline",
        createdAt: 50,
        updatedAt: 100,
      })),
    });
    const restoreDocumentFromRecovery = vi.fn(async () => {});
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("draft.md"),
    }));
    const openFile = vi.fn(async () => {});

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/next-project",
      initialPath: "draft.md",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile: vi.fn(async () => true),
      openProjectRoot,
      openFile,
      restoreDocumentFromRecovery,
      hotExitBackupStore: recoveryStore,
    });

    expect(result).toBe(true);
    expect(restoreDocumentFromRecovery).toHaveBeenCalledWith(
      "draft.md",
      "unsaved draft",
      { baselineHash: "baseline" },
    );
    expect(openFile).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith('Recover unsaved changes for "draft.md"?');
    confirm.mockRestore();
  });

  it("does not commit the target project when closing the current file is rejected", async () => {
    let latestProjectRequest = 0;
    const closeCurrentFile = vi.fn(async () => false);
    const probeProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    }));
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: createFileTree("main.md"),
    }));
    const openFile = vi.fn(async () => {});

    const result = await openProjectInCurrentWindow({
      projectRoot: "/tmp/next-project",
      currentProjectRoot: "/tmp/original",
      nextRequestId: () => ++latestProjectRequest,
      isRequestCurrent: (requestId) => requestId === latestProjectRequest,
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile,
      probeProjectRoot,
      openProjectRoot,
      openFile,
    });

    expect(result).toBe(false);
    expect(probeProjectRoot).toHaveBeenCalledWith("/tmp/next-project");
    expect(openProjectRoot).not.toHaveBeenCalled();
    expect(closeCurrentFile).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("cancels an older in-flight file open before awaiting same-project alias canonicalization", async () => {
    let latestProjectRequest = 0;
    let latestOpenFileToken = 0;
    const committedPaths: string[] = [];
    const firstOpen = createDeferred<undefined>();
    const canonicalized = createDeferred<string>();
    const closeCurrentFile = vi.fn(async () => true);
    const openProjectRoot = vi.fn(async (path: string) => ({
      projectRoot: path,
      tree: path === "/tmp/project-a" ? createFileTree("a.md") : createFileTree("b.md"),
    }));
    const openFile = vi.fn(async (path: string) => {
      const token = ++latestOpenFileToken;
      await firstOpen.promise;
      if (token !== latestOpenFileToken) {
        return;
      }
      committedPaths.push(path);
    });
    const nextRequestId = () => ++latestProjectRequest;
    const isRequestCurrent = (requestId: number) => requestId === latestProjectRequest;
    const cancelPendingOpenFile = () => {
      latestOpenFileToken += 1;
    };

    const firstRequest = openProjectInCurrentWindow({
      projectRoot: "/tmp/project-a",
      currentProjectRoot: "/tmp/original",
      nextRequestId,
      isRequestCurrent,
      cancelPendingOpenFile,
      closeCurrentFile,
      openProjectRoot,
      openFile,
    });
    await Promise.resolve();

    const secondRequest = openProjectInCurrentWindow({
      projectRoot: "/tmp/project-alias",
      currentProjectRoot: "/tmp/canonical-project",
      nextRequestId,
      isRequestCurrent,
      cancelPendingOpenFile,
      closeCurrentFile,
      openProjectRoot,
      canonicalizeProjectRoot: async () => canonicalized.promise,
      openFile,
    });

    firstOpen.resolve(undefined);
    await Promise.resolve();
    expect(committedPaths).toEqual([]);

    canonicalized.resolve("/tmp/canonical-project");

    await expect(firstRequest).resolves.toBe(false);
    await expect(secondRequest).resolves.toBe(true);
    expect(committedPaths).toEqual([]);
    expect(openProjectRoot).not.toHaveBeenCalled();
  });
});
