import { act, createElement, type FC, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranchInfo } from "../tauri-client/git";

// ── Mocks ─────────────────────────────────────────────────────────────────────

let branchInfoResult: GitBranchInfo = {
  branch: "main",
  hasUpstream: true,
  ahead: 0,
  behind: 0,
};

const gitBranchInfoCommand = vi.fn(async () => branchInfoResult);
const gitPullCommand = vi.fn(async () => "Already up to date.");
const gitPushCommand = vi.fn(async () => "Everything up-to-date");

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../tauri-client/git", () => ({
  gitBranchInfoCommand: () => gitBranchInfoCommand(),
  gitPullCommand: () => gitPullCommand(),
  gitPushCommand: () => gitPushCommand(),
}));

const { useGitStatus } = await import("./use-git-status");

// ── Harness ───────────────────────────────────────────────────────────────────

let lastStatus: ReturnType<typeof useGitStatus>;
let setProjectRoot: (root: string | null) => void;
const refreshTree = vi.fn(async () => {});

const Harness: FC = () => {
  const [projectRoot, _setProjectRoot] = useState<string | null>("/tmp/repo");
  setProjectRoot = _setProjectRoot;
  lastStatus = useGitStatus(projectRoot, refreshTree);
  return null;
};

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useGitStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    gitBranchInfoCommand.mockReset().mockImplementation(async () => branchInfoResult);
    gitPullCommand.mockReset().mockImplementation(async () => "Already up to date.");
    gitPushCommand.mockReset().mockImplementation(async () => "Everything up-to-date");
    refreshTree.mockClear();
    branchInfoResult = {
      branch: "main",
      hasUpstream: true,
      ahead: 0,
      behind: 0,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("returns hasUpstream=false when the branch has no upstream configured", async () => {
    branchInfoResult = {
      branch: "feature-local",
      hasUpstream: false,
      ahead: 0,
      behind: 0,
    };

    await act(async () => {
      root.render(createElement(Harness));
      await flushMicrotasks();
    });

    expect(lastStatus.branch).toBe("feature-local");
    expect(lastStatus.hasUpstream).toBe(false);
  });

  it("discards stale branch-info responses when the project root changes", async () => {
    // First call: returns info for repo A.
    let callIndex = 0;
    gitBranchInfoCommand.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        // Delay the first response so it arrives after the second.
        await new Promise((r) => setTimeout(r, 50));
        return {
          branch: "stale-branch",
          hasUpstream: false,
          ahead: 99,
          behind: 99,
        };
      }
      return {
        branch: "main",
        hasUpstream: true,
        ahead: 0,
        behind: 0,
      };
    });

    // Render with initial project root — starts async fetch for A.
    await act(async () => {
      root.render(createElement(Harness));
      await flushMicrotasks();
    });

    // Switch project root before A's response arrives — starts fetch for B.
    await act(async () => {
      setProjectRoot("/tmp/repo-b");
      await flushMicrotasks();
    });

    // Wait for both promises to settle (A's 50ms delay included).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // State should reflect B (the current root), not the stale A response.
    expect(lastStatus.branch).toBe("main");
    expect(lastStatus.hasUpstream).toBe(true);
    expect(lastStatus.ahead).toBe(0);
  });

  it("refreshes branch info after a failed pull", async () => {
    // Mount with default branch info (ahead: 0).
    await act(async () => {
      root.render(createElement(Harness));
      await flushMicrotasks();
    });
    expect(lastStatus.ahead).toBe(0);

    // Simulate a failed ff-only pull that still updated the remote ref,
    // changing the ahead/behind counts.
    gitPullCommand.mockRejectedValueOnce("fatal: Not possible to fast-forward");
    branchInfoResult = {
      branch: "main",
      hasUpstream: true,
      ahead: 1,
      behind: 1,
    };

    // Stub window.alert so it doesn't throw in jsdom.
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    // Trigger the pull and wait inside a single act() so React flushes
    // all state updates — including the fire-and-forget fetchBranchInfo()
    // that runs in the finally block.
    await act(async () => {
      lastStatus.pull();
      await new Promise((r) => setTimeout(r, 100));
    });

    // Branch info must have been refreshed even though pull failed.
    expect(gitBranchInfoCommand).toHaveBeenCalledTimes(2); // initial + post-pull
    expect(lastStatus.ahead).toBe(1);
    expect(lastStatus.behind).toBe(1);

    alertSpy.mockRestore();
  });
});
