#!/usr/bin/env node

import process from "node:process";
import { normalizeCliArgs } from "./devx-cli.mjs";
import {
  buildVitestArgs,
  runFocusedVitestRun,
} from "./focused-vitest.mjs";

const DEFAULT_ARGS = ["exec", "vitest", "run"];

export function buildWatchedVitestArgs(extraArgs = []) {
  return buildVitestArgs(normalizeCliArgs(extraArgs), {
    baseArgs: DEFAULT_ARGS,
  });
}

export async function runWatchedVitestCli(argv = process.argv.slice(2), options = {}) {
  return runFocusedVitestRun(normalizeCliArgs(argv), {
    ...options,
    baseArgs: DEFAULT_ARGS,
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(await runWatchedVitestCli());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
