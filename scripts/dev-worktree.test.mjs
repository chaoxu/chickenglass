import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDevWorktree,
  resolveDefaultWorktreePath,
  sanitizeDevWorktreeName,
} from "./dev-worktree.mjs";

const cliPath = join(process.cwd(), "scripts", "dev-worktree.mjs");

// Strip git env vars that git sets for subprocesses. Without this, when
// these tests run inside a parent git command (e.g. inside the pre-push
// hook), child `git init` / `git commit` in tmp repos inherit GIT_DIR and
// the main repo's core.hooksPath — their commits then try to invoke
// lefthook in /tmp and fail.
function childEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_NAMESPACE;
  delete env.GIT_PREFIX;
  return env;
}

function run(cwd, ...args) {
  return execFileSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    env: childEnv(),
  }).trim();
}

function initRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "coflat-dev-worktree-"));
  run(repoRoot, "git", "init", "-b", "main");
  run(repoRoot, "git", "config", "user.name", "Test User");
  run(repoRoot, "git", "config", "user.email", "test@example.com");
  writeFileSync(join(repoRoot, "tracked.txt"), "base\n");
  writeFileSync(join(repoRoot, "package.json"), "{\n  \"name\": \"tmp\"\n}\n");
  run(repoRoot, "git", "add", "tracked.txt", "package.json");
  run(repoRoot, "git", "commit", "-m", "initial");
  return repoRoot;
}

function initBareOrigin() {
  const bareRoot = mkdtempSync(join(tmpdir(), "coflat-dev-worktree-origin-"));
  run(bareRoot, "git", "init", "--bare");
  return bareRoot;
}

function pushRemoteBranch(originRoot, branch, filename, contents) {
  const cloneRoot = mkdtempSync(join(tmpdir(), "coflat-dev-worktree-clone-"));
  run(tmpdir(), "git", "clone", originRoot, cloneRoot);
  run(cloneRoot, "git", "config", "user.name", "Test User");
  run(cloneRoot, "git", "config", "user.email", "test@example.com");
  run(cloneRoot, "git", "checkout", "-b", branch);
  writeFileSync(join(cloneRoot, filename), contents);
  run(cloneRoot, "git", "add", filename);
  run(cloneRoot, "git", "commit", "-m", `add ${branch}`);
  run(cloneRoot, "git", "push", "-u", "origin", branch);
  return cloneRoot;
}

const cleanup = [];

afterEach(() => {
  while (cleanup.length > 0) {
    rmSync(cleanup.pop(), { recursive: true, force: true });
  }
});

describe("dev-worktree", () => {
  it("creates a worktree with a sanitized default branch and path", () => {
    const repoRoot = initRepo();
    cleanup.push(repoRoot);
    mkdirSync(join(repoRoot, "node_modules"));

    const result = createDevWorktree({
      repoRoot,
      name: "Perf 444",
    });

    expect(result.branch).toBe("perf-444");
    expect(realpathSync(result.worktreePath)).toBe(realpathSync(resolveDefaultWorktreePath(repoRoot, "Perf 444")));
    expect(run(result.worktreePath, "git", "branch", "--show-current")).toBe("perf-444");
    expect(lstatSync(join(result.worktreePath, "node_modules")).isSymbolicLink()).toBe(true);
  });

  it("does not sweep dirty tracked changes into the new worktree", () => {
    const repoRoot = initRepo();
    cleanup.push(repoRoot);
    writeFileSync(join(repoRoot, "tracked.txt"), "dirty\n");

    const result = createDevWorktree({
      repoRoot,
      name: "dirty-check",
    });

    expect(result.rootDirty).toBe(true);
    expect(readFileSync(join(result.worktreePath, "tracked.txt"), "utf8")).toBe("base\n");
  });

  it("fails when the target branch already exists", () => {
    const repoRoot = initRepo();
    cleanup.push(repoRoot);

    createDevWorktree({
      repoRoot,
      name: "existing-branch",
    });

    expect(() =>
      createDevWorktree({
        repoRoot,
        name: "something-else",
        branch: "existing-branch",
      }),
    ).toThrow("Branch already exists: existing-branch");
  });

  it("CLI fetches the requested remote base ref and resolves relative paths from the repo root", () => {
    const repoRoot = initRepo();
    const originRoot = initBareOrigin();
    cleanup.push(repoRoot, originRoot);

    run(repoRoot, "git", "remote", "add", "origin", originRoot);
    run(repoRoot, "git", "push", "-u", "origin", "main");
    const cloneRoot = pushRemoteBranch(originRoot, "topic", "remote.txt", "topic\n");
    cleanup.push(cloneRoot);

    const subdir = join(repoRoot, "subdir");
    mkdirSync(subdir);

    execFileSync(
      "node",
      [
        cliPath,
        "topic-bootstrap",
        "--base",
        "origin/topic",
        "--fetch",
        "--branch",
        "codex/topic-bootstrap",
        "--path",
        "nested/topic-worktree",
      ],
      {
        cwd: subdir,
        encoding: "utf8",
        env: childEnv(),
      },
    );

    const expectedWorktreePath = join(repoRoot, "nested", "topic-worktree");
    expect(run(expectedWorktreePath, "git", "branch", "--show-current")).toBe("codex/topic-bootstrap");
    expect(readFileSync(join(expectedWorktreePath, "remote.txt"), "utf8")).toBe("topic\n");
    expect(existsSync(join(subdir, "nested", "topic-worktree"))).toBe(false);
  });
});

describe("sanitizeDevWorktreeName", () => {
  it("normalizes user-provided names into safe defaults", () => {
    expect(sanitizeDevWorktreeName("  Perf 444 / Tables  ")).toBe("perf-444-tables");
  });
});
