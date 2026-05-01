/**
 * Crash and recovery fault-injection tests.
 *
 * Covers user-visible failure modes that aren't exercised by happy-path tests:
 *   1. Disk full (ENOSPC) on save
 *   2. Permission denied (EACCES) on save
 *   3. File deleted by another process during edit
 *   4. File modified by another process during edit (existing coverage,
 *      verified again here for completeness)
 *   5. Corrupt recovery JSON / unreadable hot-exit backup on app start
 *   6. Tauri command panic surfaced through `invoke()` rejection
 *   7. Native watcher disconnect / failed status reporting
 *
 * Each test wires a fault into the smallest seam that triggers the user-
 * visible code path, then asserts on the observable outcome (dirty flag,
 * thrown error, conflict banner, recovered status, watcher status, etc.).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEditorDocumentText,
  type EditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
} from "./editor-doc-change";
import { createEditorSessionState, type SessionDocument } from "./editor-session-model";
import {
  createEditorSessionPersistence,
  type EditorSessionPersistence,
} from "./editor-session-persistence";
import {
  createEditorSessionRuntime,
  type EditorSessionRuntime,
} from "./editor-session-runtime";
import { createEditorSessionService } from "./editor-session-service";
import type { FileSystem } from "./file-manager";
import { MemoryFileSystem } from "./file-manager";
import { activateProjectDocument } from "./project-document-activation";
import type { HotExitBackupStore } from "./hot-exit-backups";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("./perf", () => ({
  measureAsync: (_name: string, task: () => Promise<unknown>) => task(),
  withPerfOperation: async <T,>(
    _name: string,
    task: (operation: {
      id: string;
      name: string;
      measureAsync: <R>(spanName: string, spanTask: () => Promise<R>) => Promise<R>;
      measureSync: <R>(spanName: string, spanTask: () => R) => R;
      end: () => void;
    }) => Promise<T>,
  ): Promise<T> =>
    task({
      id: "test-operation",
      name: "test-operation",
      measureAsync: async (_n, t) => t(),
      measureSync: (_n, t) => t(),
      end: () => {},
    }),
}));

vi.mock("../lib/tauri", () => ({
  isTauri: () => false,
}));

vi.mock("./confirm-action", () => ({
  confirmAction: vi.fn(async () => true),
}));

// File-level watcher fault-injection mocks. The mutable state lets individual
// tests choose between "watch succeeds" and "watch rejects".
const watcherMocks = vi.hoisted(() => {
  type Listener = (event: { payload: unknown }) => void;
  const state = {
    listeners: [] as Array<{ eventName: string; listener: Listener }>,
    watchImpl: async (_token: number, _debounce: number) =>
      ({ applied: true, root: "/root" }) as unknown,
  };
  return {
    state,
    listen: vi.fn(async (eventName: string, listener: Listener) => {
      state.listeners.push({ eventName, listener });
      return () => {};
    }),
    watchDirectoryCommand: vi.fn(async (token: number, debounce: number) =>
      state.watchImpl(token, debounce),
    ),
    unwatchDirectoryCommand: vi.fn(async () => true),
    reset() {
      state.listeners = [];
      state.watchImpl = async () => ({ applied: true, root: "/root" });
      this.listen.mockClear();
      this.watchDirectoryCommand.mockClear();
      this.unwatchDirectoryCommand.mockClear();
    },
    emit(eventName: string, payload: unknown) {
      for (const entry of state.listeners) {
        if (entry.eventName === eventName) entry.listener({ payload });
      }
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: watcherMocks.listen,
}));

vi.mock("./tauri-client/watch", () => ({
  WATCH_STATUS_EVENT: "watch-status",
  watchDirectoryCommand: watcherMocks.watchDirectoryCommand,
  unwatchDirectoryCommand: watcherMocks.unwatchDirectoryCommand,
}));

// ── Fault-injection helper ──────────────────────────────────────────────────

type FsFault =
  | { method: keyof FileSystem; throws: Error; once?: boolean };

interface FaultSpec {
  /** Faults applied to specific FileSystem methods. */
  readonly faults?: readonly FsFault[];
}

/**
 * Wrap a real FileSystem so specific methods throw injected errors.
 *
 * Each fault either fires once (when `once: true`) or every call. Methods
 * not listed pass through to the underlying filesystem.
 */
function mockFileSystemWith(
  base: FileSystem,
  spec: FaultSpec,
): FileSystem {
  const remaining = new Map<keyof FileSystem, FsFault>();
  for (const fault of spec.faults ?? []) {
    remaining.set(fault.method, { ...fault });
  }
  const trip = (method: keyof FileSystem): void => {
    const fault = remaining.get(method);
    if (!fault) return;
    if (fault.once) {
      remaining.delete(method);
    }
    throw fault.throws;
  };

  return {
    listTree: () => {
      trip("listTree");
      return base.listTree();
    },
    listChildren: base.listChildren
      ? (path: string) => {
          trip("listChildren");
          return base.listChildren?.(path) ?? Promise.resolve([]);
        }
      : undefined,
    readFile: (path: string) => {
      trip("readFile");
      return base.readFile(path);
    },
    writeFile: (path: string, content: string) => {
      trip("writeFile");
      return base.writeFile(path, content);
    },
    writeFileIfUnchanged: base.writeFileIfUnchanged
      ? (path: string, content: string, expectedHash: string) => {
          trip("writeFileIfUnchanged");
          const fn = base.writeFileIfUnchanged;
          if (!fn) return Promise.resolve({ written: false });
          return fn.call(base, path, content, expectedHash);
        }
      : undefined,
    createFile: (path: string, content?: string) => {
      trip("createFile");
      return base.createFile(path, content);
    },
    exists: (path: string) => {
      trip("exists");
      return base.exists(path);
    },
    renameFile: (oldPath: string, newPath: string) => {
      trip("renameFile");
      return base.renameFile(oldPath, newPath);
    },
    createDirectory: (path: string) => {
      trip("createDirectory");
      return base.createDirectory(path);
    },
    deleteFile: (path: string) => {
      trip("deleteFile");
      return base.deleteFile(path);
    },
    writeFileBinary: (path: string, data: Uint8Array) => {
      trip("writeFileBinary");
      return base.writeFileBinary(path, data);
    },
    readFileBinary: (path: string) => {
      trip("readFileBinary");
      return base.readFileBinary(path);
    },
  };
}

// ── Session harness ──────────────────────────────────────────────────────────

interface SessionHarness {
  runtime: EditorSessionRuntime;
  persistence: EditorSessionPersistence;
  service: ReturnType<typeof createEditorSessionService>;
}

function buildSession(
  fs: FileSystem,
  currentDocument: SessionDocument,
  buffers: Record<string, string>,
  liveDocs: Record<string, string>,
): SessionHarness {
  const runtime = createEditorSessionRuntime();
  runtime.commit(
    createEditorSessionState(currentDocument),
    { editorDoc: liveDocs[currentDocument.path] ?? "" },
  );
  for (const [path, content] of Object.entries(buffers)) {
    runtime.buffers.set(path, createEditorDocumentText(content));
  }
  for (const [path, content] of Object.entries(liveDocs)) {
    runtime.liveDocs.set(path, createEditorDocumentText(content));
  }
  // Initialise the pipeline so the conditional-write path is exercised.
  runtime.pipeline.initPath(currentDocument.path, buffers[currentDocument.path] ?? "");
  // Mark as dirty so saveCurrentDocument actually attempts a write.
  runtime.commit(runtime.setPathDirty(currentDocument.path, true));

  let persistence!: EditorSessionPersistence;
  runtime.setWriteDocumentSnapshot((path, snapshot) =>
    persistence.writeDocumentSnapshot(path, snapshot.content, {
      createTargetIfMissing: snapshot.createTargetIfMissing,
      expectedBaselineHash: snapshot.expectedBaselineHash,
    }),
  );
  persistence = createEditorSessionPersistence({
    fs,
    refreshTree: async () => {},
    addRecentFile: () => {},
    requestUnsavedChangesDecision: async () => "discard",
    runtime,
  });
  const service = createEditorSessionService({
    fs,
    refreshTree: async () => {},
    addRecentFile: () => {},
    requestUnsavedChangesDecision: async () => "discard",
    runtime,
    saveCurrentDocument: persistence.saveCurrentDocument,
  });

  return { runtime, persistence, service };
}

function asString(doc: EditorDocumentText | undefined): string {
  return editorDocumentToString(doc ?? emptyEditorDocument);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("fault-injection: save failures", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("propagates ENOSPC (disk full) and preserves the dirty flag", async () => {
    const memory = new MemoryFileSystem({ "main.md": "saved" });
    const enospc = Object.assign(new Error("ENOSPC: no space left on device"), {
      code: "ENOSPC",
    });
    const fs = mockFileSystemWith(memory, {
      faults: [{ method: "writeFileIfUnchanged", throws: enospc }],
    });
    const harness = buildSession(
      fs,
      { path: "main.md", name: "main.md", dirty: true },
      { "main.md": "saved" },
      { "main.md": "local edit" },
    );

    await expect(harness.persistence.saveCurrentDocument()).rejects.toBe(enospc);

    // The on-disk content is unchanged.
    await expect(memory.readFile("main.md")).resolves.toBe("saved");
    // The session still reports dirty so the user keeps their edits.
    expect(harness.runtime.isPathDirty("main.md")).toBe(true);
    expect(harness.runtime.getCurrentDocument()?.dirty).toBe(true);
    // The live edit is still in memory.
    expect(asString(harness.runtime.liveDocs.get("main.md"))).toBe("local edit");
  });

  it("propagates EACCES (permission denied) and preserves the dirty flag", async () => {
    const memory = new MemoryFileSystem({ "notes.md": "saved" });
    const eacces = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const fs = mockFileSystemWith(memory, {
      faults: [{ method: "writeFileIfUnchanged", throws: eacces }],
    });
    const harness = buildSession(
      fs,
      { path: "notes.md", name: "notes.md", dirty: true },
      { "notes.md": "saved" },
      { "notes.md": "local edit" },
    );

    await expect(harness.persistence.saveCurrentDocument()).rejects.toBe(eacces);

    await expect(memory.readFile("notes.md")).resolves.toBe("saved");
    expect(harness.runtime.isPathDirty("notes.md")).toBe(true);
  });
});

describe("fault-injection: external file lifecycle", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("flags a deleted-while-editing file as a conflict without losing edits", async () => {
    // The watcher delivers a file-changed event after the path disappears.
    // syncExternalChange is what runs in response; it must keep unsaved
    // edits and surface a "deleted" conflict so the banner can prompt.
    const memory = new MemoryFileSystem({ "main.md": "original" });
    const harness = buildSession(
      memory,
      { path: "main.md", name: "main.md", dirty: true },
      { "main.md": "original" },
      { "main.md": "local edit not yet saved" },
    );

    // Another process deletes the file out from under us.
    await memory.deleteFile("main.md");

    const result = await harness.service.syncExternalChange("main.md");

    expect(result).toBe("notify");
    // The unsaved buffer is intact.
    expect(asString(harness.runtime.liveDocs.get("main.md")))
      .toBe("local edit not yet saved");
    expect(harness.runtime.isPathDirty("main.md")).toBe(true);
    // A "deleted" conflict is surfaced so the UI can show the banner.
    expect(harness.runtime.getState().externalConflict).toEqual({
      kind: "deleted",
      path: "main.md",
    });
  });

  it("flags a modified-while-editing file as a conflict (verified)", async () => {
    // The "already handled" case from the issue: confirm the existing path
    // really does what it claims.
    const memory = new MemoryFileSystem({ "main.md": "original" });
    const harness = buildSession(
      memory,
      { path: "main.md", name: "main.md", dirty: true },
      { "main.md": "original" },
      { "main.md": "local edit" },
    );

    // External writer changes the file on disk.
    await memory.writeFile("main.md", "external edit");

    const result = await harness.service.syncExternalChange("main.md");

    expect(result).toBe("notify");
    expect(asString(harness.runtime.liveDocs.get("main.md"))).toBe("local edit");
    expect(harness.runtime.isPathDirty("main.md")).toBe(true);
    expect(harness.runtime.getState().externalConflict).toEqual({
      kind: "modified",
      path: "main.md",
    });
  });
});

describe("fault-injection: hot-exit backup recovery", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function makeBackupStore(spec: {
    listBackups?: () => Promise<unknown>;
    readBackup?: () => Promise<unknown>;
  }): HotExitBackupStore {
    return {
      writeBackup: vi.fn(),
      listBackups: (spec.listBackups ?? (async () => [])) as HotExitBackupStore["listBackups"],
      readBackup: (spec.readBackup ?? (async () => null)) as HotExitBackupStore["readBackup"],
      deleteBackup: vi.fn(async () => {}),
    };
  }

  it("falls back to the default document when listBackups rejects (corrupt index)", async () => {
    // A corrupt recovery JSON manifests as the backend returning an error
    // when listing backups. The startup activator must not crash and must
    // still open the project's preferred document.
    const corruption = new Error("invalid JSON in backup manifest");
    const backupStore = makeBackupStore({
      listBackups: async () => {
        throw corruption;
      },
    });
    const openFile = vi.fn(async (_path: string) => {});

    const result = await activateProjectDocument({
      fileTree: { name: "root", path: "", isDirectory: true, children: [] },
      hotExitBackupStore: backupStore,
      openFile,
      preferredDocumentPath: "main.md",
      projectRoot: "/project",
      restoreDocumentFromRecovery: vi.fn(),
    });

    expect(result).toEqual({ status: "opened-preferred", path: "main.md" });
    expect(openFile).toHaveBeenCalledWith("main.md");
    // The corruption was logged so a developer can see what went wrong.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("hot-exit"),
      corruption,
    );
  });

  it("falls back to the default document when readBackup rejects (corrupt entry)", async () => {
    // A specific backup entry is unreadable / has invalid JSON: don't crash,
    // log, and continue to the preferred document.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const corruption = new Error("corrupt backup payload");
    const backupStore = makeBackupStore({
      listBackups: async () => [
        {
          id: "bk1",
          name: "draft.md",
          path: "draft.md",
          projectKey: "key",
          projectRoot: "/project",
          contentHash: "h",
          bytes: 4,
          updatedAt: 1,
        },
      ],
      readBackup: async () => {
        throw corruption;
      },
    });
    const openFile = vi.fn(async (_path: string) => {});
    const restoreDocumentFromRecovery = vi.fn();

    const result = await activateProjectDocument({
      fileTree: { name: "root", path: "", isDirectory: true, children: [] },
      hotExitBackupStore: backupStore,
      openFile,
      preferredDocumentPath: "main.md",
      projectRoot: "/project",
      restoreDocumentFromRecovery,
    });

    expect(result).toEqual({ status: "opened-preferred", path: "main.md" });
    expect(restoreDocumentFromRecovery).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("hot-exit"),
      corruption,
    );
  });
});

describe("fault-injection: Tauri command panic", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("rejects openFile cleanly when the Tauri-shaped read rejects", async () => {
    // Simulate a Rust command panicking (e.g. unwrap on a None) — Tauri
    // surfaces this as the invoke() promise rejecting with a string.
    const memory = new MemoryFileSystem({ "main.md": "saved", "other.md": "x" });
    const tauriPanic = "panicked at 'called Option::unwrap() on None', src/commands/fs.rs";
    const fs = mockFileSystemWith(memory, {
      faults: [{ method: "readFile", throws: new Error(tauriPanic) }],
    });
    const harness = buildSession(
      fs,
      { path: "other.md", name: "other.md", dirty: false },
      { "other.md": "x" },
      { "other.md": "x" },
    );
    // Cleanly exit the dirty edit-suite default — switch to a clean state.
    harness.runtime.commit(harness.runtime.setPathDirty("other.md", false));

    await expect(harness.service.openFile("main.md")).rejects.toThrow(
      /panicked/,
    );

    // The session was not left half-open: the previous document is still
    // current, and the failed path has no buffers attached.
    expect(harness.runtime.getCurrentDocument()?.path).toBe("other.md");
    expect(harness.runtime.buffers.has("main.md")).toBe(false);
    expect(harness.runtime.liveDocs.has("main.md")).toBe(false);
  });
});

describe("fault-injection: native watcher disconnect", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    watcherMocks.reset();
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("transitions to degraded then recovers to healthy on watcher events", async () => {
    const watcherModule = await import("./file-watcher");
    type FileWatcherStatus = ReturnType<
      InstanceType<typeof watcherModule.FileWatcher>["getStatus"]
    >;
    const statusReports: FileWatcherStatus[] = [];
    const watcher = new watcherModule.FileWatcher({
      refreshTree: async () => {},
      syncExternalChange: async () => "notify",
      handleWatcherStatus: (status) => {
        statusReports.push(status);
      },
    });

    await watcher.watch("/root");
    expect(watcher.getStatus().status).toBe("healthy");
    const watchToken = watcher.getStatus().generation;
    expect(watchToken).not.toBeNull();

    // Backend emits a degraded status (e.g. inotify ran out of watches).
    watcherMocks.emit("watch-status", {
      status: "degraded",
      generation: watchToken,
      root: "/root",
      message: "dropped events",
      error: "watch limit reached",
    });
    expect(watcher.getStatus().status).toBe("degraded");
    expect(watcher.getStatus().error).toBe("watch limit reached");

    // The backend reconnects and reports healthy again.
    watcherMocks.emit("watch-status", {
      status: "healthy",
      generation: watchToken,
      root: "/root",
      message: "watcher recovered",
    });
    expect(watcher.getStatus().status).toBe("healthy");

    expect(statusReports.map((s) => s.status)).toEqual(
      expect.arrayContaining(["starting", "healthy", "degraded", "healthy"]),
    );

    await watcher.unwatch();
    expect(watcher.getStatus().status).toBe("stopped");
  });

  it("reports failed status when the backend rejects watchDirectory", async () => {
    watcherMocks.state.watchImpl = async () => {
      throw new Error("watcher backend offline");
    };

    const watcherModule = await import("./file-watcher");
    const watcher = new watcherModule.FileWatcher({
      refreshTree: async () => {},
      syncExternalChange: async () => "notify",
    });

    await expect(watcher.watch("/root")).rejects.toThrow(/watcher backend offline/);

    expect(watcher.getStatus().status).toBe("failed");
    expect(watcher.getStatus().error).toContain("watcher backend offline");
  });
});
