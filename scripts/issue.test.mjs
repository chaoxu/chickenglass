import { describe, expect, it } from "vitest";

import {
  buildTeaIssueArgs,
  buildVerifiedIssueClosePlan,
  DEFAULT_REPO,
  formatVerifiedIssueClosePlan,
  runVerifiedIssueClose,
} from "./issue.mjs";

describe("issue CLI wrapper", () => {
  it("lists issues with the canonical repo argument order", () => {
    expect(buildTeaIssueArgs(["list", "--limit", "20"])).toEqual([
      "issues",
      "--repo",
      DEFAULT_REPO,
      "--limit",
      "20",
    ]);
  });

  it("views issues without using the broken create-style argument order", () => {
    expect(buildTeaIssueArgs(["view", "1399"])).toEqual([
      "issues",
      "--repo",
      DEFAULT_REPO,
      "1399",
    ]);
  });

  it("creates issues with --repo after the create subcommand", () => {
    expect(buildTeaIssueArgs(["create", "--title", "T", "--description", "D"])).toEqual([
      "issues",
      "create",
      "--repo",
      DEFAULT_REPO,
      "--title",
      "T",
      "--description",
      "D",
    ]);
  });

  it("comments on issues through the tea comment command", () => {
    expect(buildTeaIssueArgs(["comment", "1402", "Verification: pass"])).toEqual([
      "comment",
      "--repo",
      DEFAULT_REPO,
      "1402",
      "Verification: pass",
    ]);
  });

  it("closes issues with --repo after the close subcommand", () => {
    expect(buildTeaIssueArgs(["close", "1399"])).toEqual([
      "issues",
      "close",
      "--repo",
      DEFAULT_REPO,
      "1399",
    ]);
  });

  it("supports an explicit repo override once without duplicating --repo", () => {
    expect(buildTeaIssueArgs(["list", "--repo", "owner/repo", "--state", "closed"])).toEqual([
      "issues",
      "--repo",
      "owner/repo",
      "--state",
      "closed",
    ]);
  });

  it("plans verified issue close with commit and verification context", () => {
    const plan = buildVerifiedIssueClosePlan([
      "verify-close",
      "408",
      "513",
      "--commit",
      "abc123",
      "--verify",
      "pnpm typecheck",
      "--verify",
      "pnpm test,pnpm test:browser",
    ]);

    expect(plan.repo).toBe(DEFAULT_REPO);
    expect(plan.issues).toEqual(["408", "513"]);
    expect(plan.verifyItems).toEqual([
      "pnpm typecheck",
      "pnpm test",
      "pnpm test:browser",
    ]);
    expect(plan.commands.map((entry) => entry.argv.slice(0, 4))).toEqual([
      ["git", "rev-parse", "--verify", "abc123^{commit}"],
      ["git", "status", "--short"],
      ["sh", "-lc", "pnpm typecheck"],
      ["sh", "-lc", "pnpm test"],
      ["sh", "-lc", "pnpm test:browser"],
      ["tea", "issues", "--repo", DEFAULT_REPO],
      ["tea", "issues", "--repo", DEFAULT_REPO],
      ["tea", "comment", "--repo", DEFAULT_REPO],
      ["tea", "comment", "--repo", DEFAULT_REPO],
      ["tea", "issues", "close", "--repo"],
    ]);
  });

  it("rejects verified close without issues, commit, or verification entries", () => {
    expect(() => buildVerifiedIssueClosePlan(["verify-close", "--commit", "abc", "--verify", "test"])).toThrow(
      "verify-close requires at least one issue number.",
    );
    expect(() => buildVerifiedIssueClosePlan(["verify-close", "1", "--verify", "test"])).toThrow(
      "verify-close requires --commit <sha>.",
    );
    expect(() => buildVerifiedIssueClosePlan(["verify-close", "1", "--commit", "abc"])).toThrow(
      "verify-close requires at least one --verify entry.",
    );
  });

  it("prints dry-run commands without executing them", () => {
    const output = { value: "", write(chunk) { this.value += String(chunk); } };
    const calls = [];
    const status = runVerifiedIssueClose([
      "verify-close",
      "408",
      "--commit",
      "abc123",
      "--verify",
      "pnpm test",
      "--dry-run",
    ], {
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return { status: 0 };
      },
      stdout: output,
    });

    expect(status).toBe(0);
    expect(calls).toEqual([]);
    expect(output.value).toContain("tea issues close --repo chaoxu/coflat 408");
  });

  it("runs verification before viewing or closing issues", () => {
    const calls = [];
    const status = runVerifiedIssueClose([
      "verify-close",
      "408",
      "--commit",
      "abc123",
      "--verify",
      "pnpm test",
      "--allow-dirty",
    ], {
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return { status: 0, stdout: "" };
      },
    });

    expect(status).toBe(0);
    expect(calls.slice(0, 4)).toEqual([
      ["git", "rev-parse", "--verify", "abc123^{commit}"],
      ["git", "status", "--short"],
      ["sh", "-lc", "pnpm test"],
      ["tea", "issues", "--repo", DEFAULT_REPO, "408"],
    ]);
  });

  it("stops before issue mutation when verification fails", () => {
    const calls = [];
    const status = runVerifiedIssueClose([
      "verify-close",
      "408",
      "--commit",
      "abc123",
      "--verify",
      "pnpm test",
      "--allow-dirty",
    ], {
      spawnSync(command, args) {
        calls.push([command, ...args]);
        if (command === "sh") {
          return { status: 1, stdout: "" };
        }
        return { status: 0, stdout: "" };
      },
    });

    expect(status).toBe(1);
    expect(calls).toEqual([
      ["git", "rev-parse", "--verify", "abc123^{commit}"],
      ["git", "status", "--short"],
      ["sh", "-lc", "pnpm test"],
    ]);
  });

  it("blocks verified close on a dirty worktree unless explicitly allowed", () => {
    const calls = [];
    expect(() =>
      runVerifiedIssueClose([
        "verify-close",
        "408",
        "--commit",
        "abc123",
        "--verify",
        "pnpm test",
      ], {
        spawnSync(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "status") {
            return { status: 0, stdout: " M src/a.ts\n" };
          }
          return { status: 0, stdout: "" };
        },
      })
    ).toThrow("Working tree is dirty.");

    expect(calls).toEqual([
      ["git", "rev-parse", "--verify", "abc123^{commit}"],
      ["git", "status", "--short"],
    ]);
  });

  it("formats verified close plans for review", () => {
    const plan = buildVerifiedIssueClosePlan([
      "verify-close",
      "408",
      "--commit",
      "abc123",
      "--verify",
      "pnpm test",
    ]);

    expect(formatVerifiedIssueClosePlan(plan)).toContain("Issues: 408");
    expect(formatVerifiedIssueClosePlan(plan)).toContain("- pnpm test");
  });
});
