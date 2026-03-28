import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  isTauri: true,
  currentBranch: "main" as string | null,
  confirmResult: true,
  switchCalls: [] as Array<{ name: string; force: boolean }>,
  createCalls: [] as Array<{ name: string; force: boolean }>,
  reloadFileCalls: [] as string[],
  refreshTreeCalls: 0,
  dirtyWorktreeOnFirstAttempt: false,
  switchShouldThrow: null as string | null,
  reset() {
    this.isTauri = true;
    this.currentBranch = "main";
    this.confirmResult = true;
    this.switchCalls = [];
    this.createCalls = [];
    this.reloadFileCalls = [];
    this.refreshTreeCalls = 0;
    this.dirtyWorktreeOnFirstAttempt = false;
    this.switchShouldThrow = null;
  },
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => mockState.isTauri,
}));

vi.mock("../tauri-client/git", () => ({
  DIRTY_WORKTREE_PREFIX: "DIRTY_WORKTREE: ",
  isDirtyWorktreeError: (err: unknown) =>
    typeof err === "string" && err.startsWith("DIRTY_WORKTREE: "),
  gitCurrentBranchCommand: async () => mockState.currentBranch,
  gitListBranchesCommand: async () => [],
  gitSwitchBranchCommand: async (name: string, force: boolean) => {
    if (mockState.switchShouldThrow) throw mockState.switchShouldThrow;
    if (mockState.dirtyWorktreeOnFirstAttempt && !force) {
      throw "DIRTY_WORKTREE: uncommitted changes";
    }
    mockState.switchCalls.push({ name, force });
  },
  gitCreateBranchCommand: async (name: string, force: boolean) => {
    if (mockState.dirtyWorktreeOnFirstAttempt && !force) {
      throw "DIRTY_WORKTREE: uncommitted changes";
    }
    mockState.createCalls.push({ name, force });
  },
}));

vi.mock("../confirm-action", () => ({
  confirmAction: async () => mockState.confirmResult,
}));

const { useGitBranch } = await import("./use-git-branch");
import type { GitBranchController, UseGitBranchOptions } from "./use-git-branch";

let capturedController: GitBranchController | null = null;

function Harness(props: UseGitBranchOptions): null {
  capturedController = useGitBranch(props);
  return null;
}

function defaultProps(overrides?: Partial<UseGitBranchOptions>): UseGitBranchOptions {
  return {
    projectRoot: "/tmp/test-project",
    refreshTree: async () => { mockState.refreshTreeCalls++; },
    reloadFile: async (path: string) => { mockState.reloadFileCalls.push(path); },
    currentPath: "index.md",
    hasDirtyDocument: false,
    ...overrides,
  };
}

describe("useGitBranch", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockState.reset();
    capturedController = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("switches branch and refreshes when editor is clean and git is clean", async () => {
    await act(async () => {
      root.render(createElement(Harness, defaultProps()));
    });

    await act(async () => {
      await capturedController!.switchBranch("feature");
    });

    expect(mockState.switchCalls).toEqual([{ name: "feature", force: false }]);
    expect(mockState.refreshTreeCalls).toBe(1);
    expect(mockState.reloadFileCalls).toEqual(["index.md"]);
  });

  it("prompts and aborts when editor has unsaved changes and user cancels", async () => {
    mockState.confirmResult = false;

    await act(async () => {
      root.render(createElement(Harness, defaultProps({ hasDirtyDocument: true })));
    });

    await act(async () => {
      await capturedController!.switchBranch("feature");
    });

    expect(mockState.switchCalls).toEqual([]);
    expect(mockState.refreshTreeCalls).toBe(0);
    expect(mockState.reloadFileCalls).toEqual([]);
  });

  it("proceeds when editor has unsaved changes and user confirms", async () => {
    mockState.confirmResult = true;

    await act(async () => {
      root.render(createElement(Harness, defaultProps({ hasDirtyDocument: true })));
    });

    await act(async () => {
      await capturedController!.switchBranch("feature");
    });

    expect(mockState.switchCalls).toEqual([{ name: "feature", force: false }]);
    expect(mockState.refreshTreeCalls).toBe(1);
    expect(mockState.reloadFileCalls).toEqual(["index.md"]);
  });

  it("prompts and aborts on dirty worktree when user cancels", async () => {
    mockState.dirtyWorktreeOnFirstAttempt = true;
    mockState.confirmResult = false;

    await act(async () => {
      root.render(createElement(Harness, defaultProps()));
    });

    await act(async () => {
      await capturedController!.switchBranch("feature");
    });

    expect(mockState.switchCalls).toEqual([]);
    expect(mockState.refreshTreeCalls).toBe(0);
    expect(mockState.reloadFileCalls).toEqual([]);
  });

  it("retries with force on dirty worktree when user confirms", async () => {
    mockState.dirtyWorktreeOnFirstAttempt = true;
    mockState.confirmResult = true;

    await act(async () => {
      root.render(createElement(Harness, defaultProps()));
    });

    await act(async () => {
      await capturedController!.switchBranch("feature");
    });

    expect(mockState.switchCalls).toEqual([{ name: "feature", force: true }]);
    expect(mockState.refreshTreeCalls).toBe(1);
    expect(mockState.reloadFileCalls).toEqual(["index.md"]);
  });

  it("does not reload when no file is open", async () => {
    await act(async () => {
      root.render(createElement(Harness, defaultProps({ currentPath: null })));
    });

    await act(async () => {
      await capturedController!.switchBranch("feature");
    });

    expect(mockState.switchCalls).toEqual([{ name: "feature", force: false }]);
    expect(mockState.refreshTreeCalls).toBe(1);
    expect(mockState.reloadFileCalls).toEqual([]);
  });

  it("createBranch follows the same guards", async () => {
    mockState.confirmResult = false;

    await act(async () => {
      root.render(createElement(Harness, defaultProps({ hasDirtyDocument: true })));
    });

    await act(async () => {
      await capturedController!.createBranch("new-branch");
    });

    expect(mockState.createCalls).toEqual([]);
    expect(mockState.refreshTreeCalls).toBe(0);
  });

  it("propagates non-dirty-worktree errors", async () => {
    mockState.switchShouldThrow = "fatal: invalid reference";

    await act(async () => {
      root.render(createElement(Harness, defaultProps()));
    });

    await expect(
      act(async () => {
        await capturedController!.switchBranch("nonexistent");
      }),
    ).rejects.toBe("fatal: invalid reference");

    expect(mockState.refreshTreeCalls).toBe(0);
    expect(mockState.reloadFileCalls).toEqual([]);
  });
});
