#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

const DEFAULT_ARGS = [
  "exec",
  "vitest",
  "run",
  "--pool",
  "forks",
  "--no-file-parallelism",
  "--maxWorkers",
  "1",
];

function terminateChild(child, signal = "SIGTERM") {
  if (!child?.pid) {
    return;
  }

  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function looksLikeExplicitTestPath(arg) {
  return !arg.startsWith("-") &&
    !/[?*[\]{}]/.test(arg) &&
    /\.(?:[cm]?[jt]sx?)$/.test(arg);
}

export function partitionFocusedVitestArgs(argv = []) {
  const sharedArgs = [];
  const explicitPaths = [];

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (looksLikeExplicitTestPath(arg)) {
      explicitPaths.push(arg);
      continue;
    }
    sharedArgs.push(arg);
  }

  return { explicitPaths, sharedArgs };
}

export function findMissingExplicitPaths(argv = [], exists = existsSync) {
  return partitionFocusedVitestArgs(argv).explicitPaths.filter((path) => !exists(path));
}

export function buildFocusedVitestArgs(extraArgs = []) {
  return [...DEFAULT_ARGS, ...extraArgs];
}

export async function main(argv = process.argv.slice(2)) {
  const missingPaths = findMissingExplicitPaths(argv);
  if (missingPaths.length > 0) {
    console.error(`Missing test file(s): ${missingPaths.join(", ")}`);
    process.exit(1);
  }

  const { explicitPaths, sharedArgs } = partitionFocusedVitestArgs(argv);
  const runs = explicitPaths.length > 0
    ? explicitPaths.map((path) => [...sharedArgs, path])
    : [sharedArgs];

  let child = null;

  let exiting = false;
  const cleanup = (signal = "SIGTERM") => {
    if (exiting) {
      return;
    }
    exiting = true;
    terminateChild(child, signal);
  };

  const handleSignal = (signal, exitCode) => {
    cleanup(signal);
    process.exit(exitCode);
  };

  const onSigint = () => handleSignal("SIGINT", 130);
  const onSigterm = () => handleSignal("SIGTERM", 143);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.once("exit", () => cleanup());

  try {
    for (const runArgs of runs) {
      const exitCode = await new Promise((resolve, reject) => {
        child = spawn("pnpm", buildFocusedVitestArgs(runArgs), {
          stdio: "inherit",
          detached: process.platform !== "win32",
          env: {
            ...process.env,
            CI: process.env.CI ?? "1",
          },
        });

        child.on("exit", (code, signal) => {
          if (signal) {
            resolve(1);
            return;
          }
          resolve(code ?? 1);
        });

        child.on("error", reject);
      });

      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
