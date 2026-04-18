#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { waitForAppUrl } from "./dev-server.mjs";

const LAST_VERIFY_PATH = resolve(".cache/devx/last-verify.json");
const OPTIONAL_FIXTURES = [
  {
    fallback: "demo/index.md",
    path: "fixtures/rankdecrease/main.md",
    purpose: "heavy scroll/perf fixture",
  },
  {
    fallback: "demo/index.md",
    path: "fixtures/cogirth/main2.md",
    purpose: "typing/perf semantic hotspots",
  },
  {
    fallback: "inline public fallback",
    path: "fixtures/cogirth/include-labels.md",
    purpose: "include composition browser regression",
  },
  {
    fallback: "inline public fallback",
    path: "fixtures/cogirth/search-mode-awareness.md",
    purpose: "search mode browser regression",
  },
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
  if (!existsSync(LAST_VERIFY_PATH)) {
    return "none";
  }
  try {
    const parsed = JSON.parse(readFileSync(LAST_VERIFY_PATH, "utf8"));
    return parsed.ok
      ? `passed at ${parsed.completedAt}`
      : `failed at ${parsed.completedAt}: ${parsed.error ?? "unknown error"}`;
  } catch {
    return `unreadable (${LAST_VERIFY_PATH})`;
  }
}

function fixtureStatus() {
  return OPTIONAL_FIXTURES.map((fixture) => {
    const present = existsSync(resolve(fixture.path));
    return {
      ...fixture,
      status: present ? "present" : `missing; fallback: ${fixture.fallback}`,
    };
  });
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
