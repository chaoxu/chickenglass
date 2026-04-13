import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const dotGitPath = join(cwd, ".git");

function run(args, env = process.env) {
  return execFileSync("pnpm", ["exec", "lefthook", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
    env,
  });
}

function isGitWorktree(env = process.env) {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    env,
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function isGitDir(path) {
  return existsSync(path) && lstatSync(path).isDirectory();
}

const gitEnv = isGitDir(dotGitPath)
  ? {
      ...process.env,
      GIT_DIR: dotGitPath,
      GIT_WORK_TREE: cwd,
    }
  : process.env;

if (!isGitWorktree(gitEnv)) {
  console.warn("[prepare] skipping hook install outside a git work tree");
} else if (isGitDir(dotGitPath)) {
  run(["install", "--force"], gitEnv);
} else {
  run(["install"], gitEnv);
}
