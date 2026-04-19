#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { formatLastVerifyStatus, readLastVerifyStatus } from "./devx-cache.mjs";
import { waitForAppUrl } from "./dev-server.mjs";
import { fixtureStatus as catalogFixtureStatus } from "./tooling-fixtures.mjs";

const OPTIONAL_FIXTURE_KEYS = [
  "rankdecrease",
  "cogirthMain2",
  "cogirthIncludeLabels",
  "cogirthSearchModeAwareness",
];

function tryRun(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function nodeModulesStatus() {
  const path = resolve("node_modules");
  if (!existsSync(path)) {
    return "missing";
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    return `linked -> ${realpathSync(path)}`;
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  return "present but not a directory";
}

async function cdpStatus(port = 9322) {
  try {
    const response = await fetch(`http://localhost:${port}/json/version`);
    if (!response.ok) {
      return `unreachable (${response.status})`;
    }
    const json = await response.json();
    return `reachable (${json.Browser ?? "unknown browser"})`;
  } catch {
    return "unreachable";
  }
}

function lastVerifyStatus() {
  return formatLastVerifyStatus(readLastVerifyStatus());
}

function fixtureStatus() {
  return OPTIONAL_FIXTURE_KEYS.map((key) => catalogFixtureStatus(key));
}

export async function main() {
  const branch = tryRun("git", ["branch", "--show-current"]) ?? "<unknown>";
  const shortStatus = tryRun("git", ["status", "--short"]) ?? "";
  const upstream = tryRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) ?? "<none>";
  const devServer = await waitForAppUrl("http://localhost:5173", { timeout: 750 })
    ? "reachable at http://localhost:5173"
    : "not reachable at http://localhost:5173";

  console.log("DevX Status");
  console.log("==========");
  console.log(`Branch: ${branch}`);
  console.log(`Upstream: ${upstream}`);
  console.log(`Git status: ${shortStatus ? "dirty" : "clean"}`);
  if (shortStatus) {
    console.log(shortStatus);
  }
  console.log(`node_modules: ${nodeModulesStatus()}`);
  console.log(`Dev server: ${devServer}`);
  console.log(`CDP browser: ${await cdpStatus()}`);
  console.log(`Last verify: ${lastVerifyStatus()}`);
  console.log("");
  console.log("Optional fixtures:");
  for (const fixture of fixtureStatus()) {
    console.log(`  ${fixture.path}: ${fixture.status} (${fixture.purpose})`);
  }
  console.log("");
  console.log(`Regression tests: pnpm test:browser:list`);
  console.log(`Verify: pnpm verify`);
  console.log(`Perf baseline/check: pnpm perf:baseline / pnpm perf:check`);
  console.log(`Worktree deps repair: pnpm dev:deps`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
