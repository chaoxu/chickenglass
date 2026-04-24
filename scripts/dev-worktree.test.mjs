import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDevWorktree,
  parseDevWorktreeArgs,
  resolveDefaultWorktreePath,
  sanitizeDevWorktreeName,
} from "./dev-worktree.mjs";

const cliPath = join(process.cwd(), "scripts", "dev-worktree.mjs");

function run(cwd, ...args) {
  const command = args[0] === "git"
    ? ["git", "-c", "core.hooksPath=/dev/null", ...args.slice(1)]
    : args;
  return execFileSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
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
  it("parses CLI options through the shared parser", () => {
    expect(
      parseDevWorktreeArgs([
        "topic-bootstrap",
        "--base=origin/topic",
        "--fetch",
        "--branch",
        "codex/topic-bootstrap",
        "--path",
        "nested/topic-worktree",
        "--no-link-node-modules",
      ]),
    ).toEqual({
      baseRef: "origin/topic",
      branch: "codex/topic-bootstrap",
      fetch: true,
      help: false,
      linkNodeModules: false,
      name: "topic-bootstrap",
      path: "nested/topic-worktree",
    });
  });

  it("keeps strict CLI validation errors", () => {
    expect(() => parseDevWorktreeArgs(["one", "two"])).toThrow(
      "Provide only one worktree name.",
    );
    expect(() => parseDevWorktreeArgs(["topic", "--bogus"])).toThrow(
      "Unknown option: --bogus",
    );
    expect(() => parseDevWorktreeArgs(["topic", "--fetch=false"])).toThrow(
      "Unknown option: --fetch=false",
    );
    expect(() => parseDevWorktreeArgs(["topic", "--help=false"])).toThrow(
      "Unknown option: --help=false",
    );
    expect(() => parseDevWorktreeArgs(["topic", "--no-link-node-modules=false"])).toThrow(
      "Unknown option: --no-link-node-modules=false",
    );
    expect(() => parseDevWorktreeArgs(["topic", "--base"])).toThrow(
      "--base requires a value.",
    );
    expect(() => parseDevWorktreeArgs(["topic", "--base", "--fetch"])).toThrow(
      "--base requires a value.",
    );
  });

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
