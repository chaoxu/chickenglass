#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { createArgParser, normalizeCliArgs } from "./devx-cli.mjs";
import { resolvePnpmCommand } from "./focused-vitest.mjs";

const VALUE_FLAGS = ["--count"];
const BOOLEAN_FLAGS = ["--help", "-h", "--shuffle"];

function shuffleCopy(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function buildRepeatRuns(paths, options = {}) {
  const count = options.count ?? 3;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--count must be a positive integer.");
  }
  if (paths.length === 0) {
    throw new Error("test:repeat requires at least one test file.");
  }

  const runs = [];
  for (let index = 0; index < count; index += 1) {
    runs.push(options.shuffle
      ? shuffleCopy(paths, options.random)
      : [...paths]);
  }
  return runs;
}

export function formatRepeatRun(run, index, total) {
  return `Repeat ${index + 1}/${total}: pnpm test:focused -- ${run.join(" ")}`;
}

export function runRepeatRuns(runs, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  const stdout = options.stdout ?? process.stdout;
  const command = options.pnpmCommand ?? resolvePnpmCommand();
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    stdout.write(`${formatRepeatRun(run, index, runs.length)}\n`);
    const result = spawn(command, ["test:focused", "--", ...run], {
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

export function printRepeatHelp(stream = process.stdout) {
  stream.write(`Usage:
  pnpm test:repeat -- src/foo.test.ts
  pnpm test:repeat -- --count 5 src/foo.test.ts src/bar.test.ts
  pnpm test:repeat -- --shuffle --count 10 src/foo.test.ts src/bar.test.ts

Runs focused tests repeatedly through pnpm test:focused.
`);
}

export function runRepeatCli(argv = process.argv.slice(2), options = {}) {
  const args = normalizeCliArgs(argv);
  if (args.includes("--help") || args.includes("-h")) {
    printRepeatHelp(options.stdout ?? process.stdout);
    return 0;
  }

  const parser = createArgParser(args, {
    booleanFlags: BOOLEAN_FLAGS,
    valueFlags: VALUE_FLAGS,
  });
  parser.assertKnownFlags([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);
  const runs = buildRepeatRuns(parser.getPositionals(), {
    count: parser.getIntFlag("--count", 3),
    shuffle: parser.hasFlag("--shuffle"),
  });
  return runRepeatRuns(runs, options);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(runRepeatCli());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
