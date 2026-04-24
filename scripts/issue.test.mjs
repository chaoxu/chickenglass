import { describe, expect, it } from "vitest";

import { buildTeaIssueArgs, DEFAULT_REPO } from "./issue.mjs";

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
});
