import { describe, expect, it } from "vitest";

import {
  buildMergeTaskSteps,
  collectRepeatedValueFlag,
  formatMergeTaskSteps,
  parseMergeTaskArgs,
  runMergeTaskSteps,
} from "./merge-task.mjs";

describe("merge-task helper", () => {
  it("collects repeated value flags without losing the rest of argv", () => {
    expect(
      collectRepeatedValueFlag([
        "--branch",
        "worker-1",
        "--check",
        "pnpm test:focused -- scripts/a.test.mjs",
        "--check=pnpm check:types",
      ], "--check"),
    ).toEqual({
      rest: ["--branch", "worker-1"],
      values: [
        "pnpm test:focused -- scripts/a.test.mjs",
        "pnpm check:types",
      ],
    });
  });

  it("requires a value for repeated flags", () => {
    expect(() => collectRepeatedValueFlag(["--check"], "--check")).toThrow(
      "--check requires a value.",
    );
  });

  it("parses the branch, base, old base, issue, checks, and run flag", () => {
    expect(
      parseMergeTaskArgs([
        "--",
        "--branch",
        "agent/feature",
        "--base",
        "main",
        "--base-ref",
        "upstream/main",
        "--old-base",
        "abc123",
        "--issue",
        "1402",
        "--check",
        "rtk pnpm check:types",
        "--run",
      ]),
    ).toEqual({
      baseBranch: "main",
      baseRef: "upstream/main",
      branch: "agent/feature",
      checks: ["rtk pnpm check:types"],
      issue: "1402",
      oldBase: "abc123",
      run: true,
    });
  });

  it("builds an rtk-prefixed merge plan", () => {
    expect(
      buildMergeTaskSteps({
        baseBranch: "main",
        baseRef: "origin/main",
        branch: "agent/feature",
        checks: ["rtk pnpm test:focused -- scripts/merge-task.test.mjs"],
        issue: "1402",
      }),
    ).toEqual([
      {
        command: ["rtk", "git", "fetch", "origin"],
        label: "Fetch base",
      },
      {
        command: ["rtk", "git", "cherry", "-v", "origin/main", "agent/feature"],
        label: "Inspect duplicate or patch-equivalent commits",
      },
      {
        command: ["rtk", "git", "switch", "agent/feature"],
        label: "Switch task branch",
      },
      {
        command: ["rtk", "git", "rebase", "origin/main"],
        label: "Rebase branch onto base",
      },
      {
        command: ["rtk", "git", "diff", "--stat", "origin/main...HEAD"],
        label: "Review branch diff",
      },
      {
        label: "Run verification",
        shell: "rtk pnpm test:focused -- scripts/merge-task.test.mjs",
      },
      {
        command: ["rtk", "git", "switch", "main"],
        label: "Manual after verification: switch base branch",
        manual: true,
      },
      {
        command: ["rtk", "git", "merge", "--ff-only", "origin/main"],
        label: "Manual after verification: update base branch",
        manual: true,
      },
      {
        command: ["rtk", "git", "merge", "--ff-only", "agent/feature"],
        label: "Manual after verification: fast-forward merge",
        manual: true,
      },
      {
        command: ["rtk", "git", "push", "origin", "main"],
        label: "Manual after verification: push base",
        manual: true,
      },
      {
        command: ["rtk", "pnpm", "issue", "--", "close", "1402"],
        label: "Manual after merge verification: close issue",
        manual: true,
      },
    ]);
  });

  it("uses --onto when an original base is provided", () => {
    expect(
      buildMergeTaskSteps({
        baseBranch: "main",
        baseRef: "origin/main",
        branch: "agent/feature",
        oldBase: "abc123",
      })[3],
    ).toEqual({
      command: ["rtk", "git", "rebase", "--onto", "origin/main", "abc123", "agent/feature"],
      label: "Replay branch onto base",
    });
  });

  it("fetches the remote inferred from a custom base ref", () => {
    expect(
      buildMergeTaskSteps({
        baseBranch: "main",
        baseRef: "upstream/main",
        branch: "agent/feature",
      })[0],
    ).toEqual({
      command: ["rtk", "git", "fetch", "upstream"],
      label: "Fetch base",
    });
  });

  it("rejects checks that are not explicitly rtk-prefixed", () => {
    expect(() =>
      buildMergeTaskSteps({
        branch: "agent/feature",
        checks: ["pnpm check:types"],
      })
    ).toThrow("--check must be an rtk-prefixed repo-root command.");
  });

  it("formats commands with shell quoting", () => {
    expect(
      formatMergeTaskSteps([
        {
          command: ["rtk", "git", "switch", "agent/branch with spaces"],
          label: "Switch",
        },
      ]),
    ).toBe("1. Switch\n   rtk git switch 'agent/branch with spaces'");
  });

  it("formats manual and blocked close steps", () => {
    expect(
      formatMergeTaskSteps([
        {
          command: ["rtk", "git", "push", "origin", "main"],
          label: "Manual push",
          manual: true,
        },
        {
          label: "Issue close blocked",
          note: "Add at least one --check before closing #1402.",
        },
      ]),
    ).toBe(
      "1. [manual] Manual push\n   rtk git push origin main\n2. Issue close blocked\n   Add at least one --check before closing #1402.",
    );
  });

  it("blocks issue close planning without a declared check", () => {
    const steps = buildMergeTaskSteps({
      baseBranch: "main",
      branch: "agent/feature",
      issue: "1402",
    });

    expect(steps.at(-1)).toEqual({
      label: "Issue close blocked",
      note: "Add at least one --check before closing #1402.",
    });
  });

  it("stops on the first failing step when executing", () => {
    const calls = [];
    const status = runMergeTaskSteps(
      [
        {
          command: ["rtk", "git", "fetch", "origin"],
          label: "Fetch",
        },
        {
          command: ["rtk", "git", "switch", "next"],
          label: "Switch",
        },
      ],
      {
        spawnSync(command, args) {
          calls.push([command, ...args]);
          return { status: calls.length === 1 ? 1 : 0 };
        },
      },
    );

    expect(status).toBe(1);
    expect(calls).toEqual([["rtk", "git", "fetch", "origin"]]);
  });

  it("does not execute manual or note steps", () => {
    const calls = [];
    const status = runMergeTaskSteps(
      [
        {
          command: ["rtk", "git", "fetch", "origin"],
          label: "Fetch",
        },
        {
          command: ["rtk", "git", "push", "origin", "main"],
          label: "Manual push",
          manual: true,
        },
        {
          label: "Issue close blocked",
          note: "Add checks first.",
        },
      ],
      {
        spawnSync(command, args) {
          calls.push([command, ...args]);
          return { status: 0 };
        },
      },
    );

    expect(status).toBe(0);
    expect(calls).toEqual([["rtk", "git", "fetch", "origin"]]);
  });
});
