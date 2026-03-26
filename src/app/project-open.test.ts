import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./file-manager";
import { openProjectInCurrentWindow } from "./project-open";

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

describe("openProjectInCurrentWindow", () => {
  it("invalidates a stale in-flight file open when a newer project switch wins", async () => {
    let latestProjectRequest = 0;
    let latestOpenFileToken = 0;
    const committedPaths: string[] = [];
    const firstOpen = createDeferred<undefined>();
    const emptyTree: FileEntry = { name: "project", path: "", isDirectory: true, children: [] };
    const openProjectRoot = vi.fn(async (path: string) => (
      path === "/tmp/project-a" ? createFileTree("a.md") : emptyTree
    ));
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
    const openProjectRoot = vi.fn(async (path: string) => (
      path === "/tmp/project-a" ? createFileTree("a.md") : createFileTree("b.md")
    ));
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
});
