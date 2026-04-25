#!/usr/bin/env node

import console from "node:console";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageManager = packageJson.packageManager;
const match = /^pnpm@(.+)$/.exec(packageManager);

if (!match) {
  console.error(`Unsupported packageManager declaration: ${packageManager}`);
  process.exit(1);
}

const expected = match[1];
const result = spawnSync("pnpm", ["--version"], {
  encoding: "utf8",
});

if (result.error) {
  console.error(`Failed to run pnpm --version: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`pnpm --version failed: ${result.stderr.trim()}`);
  process.exit(1);
}

const actual = result.stdout.trim();
if (actual !== expected) {
  console.error(
    `pnpm version mismatch: expected ${expected} from package.json packageManager, got ${actual}.`,
  );
  process.exit(1);
}
