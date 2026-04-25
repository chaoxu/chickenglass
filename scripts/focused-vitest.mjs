#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { normalizeCliArgs } from "./devx-cli.mjs";

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
const DEFAULT_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5 * 1000;
const ISOLATE_FILES_FLAG = "--isolate-files";

export function terminateChild(child, signal = "SIGTERM", options = {}) {
  if (!child?.pid) {
    return;
  }

  const platform = options.platform ?? process.platform;
  const processKill = options.processKill ?? process.kill;

  if (platform === "win32") {
    child.kill(signal);
    return;
  }

  try {
    processKill(-child.pid, signal);
  } catch (_error) {
    child.kill(signal);
  }
}

function nonNegativeIntegerEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getFocusedVitestTimeouts(env = process.env) {
  return {
    inactivityTimeoutMs: nonNegativeIntegerEnv(
      env,
      "FOCUSED_VITEST_INACTIVITY_TIMEOUT_MS",
      DEFAULT_INACTIVITY_TIMEOUT_MS,
    ),
    killGraceMs: nonNegativeIntegerEnv(
      env,
      "FOCUSED_VITEST_KILL_GRACE_MS",
      DEFAULT_KILL_GRACE_MS,
    ),
    runTimeoutMs: nonNegativeIntegerEnv(
      env,
      "FOCUSED_VITEST_TIMEOUT_MS",
      DEFAULT_RUN_TIMEOUT_MS,
    ),
  };
}

function looksLikeExplicitTestPath(arg) {
  return !arg.startsWith("-") &&
    !/[?*[\]{}]/.test(arg) &&
    /\.(?:[cm]?[jt]sx?)$/.test(arg);
}

export function partitionFocusedVitestArgs(argv = []) {
  const sharedArgs = [];
  const explicitPaths = [];
  let isolateFiles = false;

  for (const arg of normalizeCliArgs(argv)) {
    if (arg === ISOLATE_FILES_FLAG) {
      isolateFiles = true;
      continue;
    }
    if (looksLikeExplicitTestPath(arg)) {
      explicitPaths.push(arg);
      continue;
    }
    sharedArgs.push(arg);
  }

  return { explicitPaths, isolateFiles, sharedArgs };
}

export function findMissingExplicitPaths(argv = [], exists = existsSync) {
  return partitionFocusedVitestArgs(argv).explicitPaths.filter((path) => !exists(path));
}

export function buildVitestArgs(extraArgs = [], options = {}) {
  return [...(options.baseArgs ?? DEFAULT_ARGS), ...extraArgs];
}

export function buildFocusedVitestArgs(extraArgs = []) {
  return buildVitestArgs(extraArgs);
}

export function buildFocusedVitestRuns(argv = []) {
  const { explicitPaths, isolateFiles, sharedArgs } = partitionFocusedVitestArgs(argv);
  if (isolateFiles && explicitPaths.length > 0) {
    return explicitPaths.map((path) => [...sharedArgs, path]);
  }
  return explicitPaths.length > 0
    ? [[...sharedArgs, ...explicitPaths]]
    : [sharedArgs];
}

export function resolvePnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatCommand(argv) {
  return argv.map(shellQuote).join(" ");
}

export function createRecentOutputBuffer(maxLines = 100) {
  const lines = [];
  let pending = "";

  return {
    append(chunk) {
      const parts = `${pending}${String(chunk)}`.split(/\r?\n/);
      pending = parts.pop() ?? "";
      lines.push(...parts);
      while (lines.length > maxLines) {
        lines.shift();
      }
    },
    text() {
      const output = pending ? [...lines, pending] : lines;
      return output.slice(-maxLines).join("\n");
    },
  };
}

function processGroupSnapshot(pid, options = {}) {
  if (!pid || (options.platform ?? process.platform) === "win32") {
    return "";
  }

  const result = (options.spawnSync ?? spawnSync)("ps", [
    "-o",
    "pid,ppid,pgid,stat,etime,command",
    "-g",
    String(pid),
  ], {
    encoding: "utf8",
  });
  if (result.error || (result.status ?? 1) !== 0) {
    return "";
  }
  return String(result.stdout ?? "").trim();
}

function pipeChildOutput(child, streamName, output, onOutput, recentOutput) {
  child[streamName]?.on("data", (chunk) => {
    recentOutput?.append(chunk);
    onOutput(Date.now());
    output.write(chunk);
  });
}

export async function runFocusedVitestRun(runArgs, options = {}) {
  const spawnFn = options.spawnFn ?? spawn;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const terminateFn = options.terminateFn ?? terminateChild;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const {
    inactivityTimeoutMs,
    killGraceMs,
    runTimeoutMs,
  } = {
    ...getFocusedVitestTimeouts(options.env ?? process.env),
    ...options.timeouts,
  };

  return new Promise((resolve, reject) => {
    const command = resolvePnpmCommand();
    const args = buildVitestArgs(runArgs, {
      baseArgs: options.baseArgs,
    });
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    const recentOutput = createRecentOutputBuffer(options.recentOutputLines ?? 100);
    const child = spawnFn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...(options.env ?? {}),
        CI: (options.env ?? process.env).CI ?? "1",
      },
    });

    let completed = false;
    let timedOut = false;
    let runTimer = null;
    let inactivityTimer = null;
    let killTimer = null;

    const clearTimers = () => {
      if (runTimer !== null) clearTimeoutFn(runTimer);
      if (inactivityTimer !== null) clearTimeoutFn(inactivityTimer);
      if (killTimer !== null) clearTimeoutFn(killTimer);
      runTimer = null;
      inactivityTimer = null;
      killTimer = null;
    };

    const terminateForTimeout = (reason) => {
      if (completed || timedOut) return;
      timedOut = true;
      stderr.write(`[focused-vitest] ${reason}; terminating child process.\n`);
      stderr.write(`[focused-vitest] command: ${formatCommand([command, ...args])}\n`);
      stderr.write(
        `[focused-vitest] pid=${child.pid ?? "unknown"} elapsed=${Date.now() - startedAt}ms idle=${Date.now() - lastOutputAt}ms\n`,
      );
      const snapshot = processGroupSnapshot(child.pid, options);
      if (snapshot) {
        stderr.write(`[focused-vitest] process group:\n${snapshot}\n`);
      }
      const recent = recentOutput.text();
      if (recent) {
        stderr.write(`[focused-vitest] last output:\n${recent}\n`);
      }
      terminateFn(child, "SIGTERM");
      if (killGraceMs > 0) {
        killTimer = setTimeoutFn(() => terminateFn(child, "SIGKILL"), killGraceMs);
      }
    };

    const armInactivityTimer = () => {
      if (inactivityTimer !== null) clearTimeoutFn(inactivityTimer);
      if (inactivityTimeoutMs > 0) {
        inactivityTimer = setTimeoutFn(
          () => terminateForTimeout(`no output for ${inactivityTimeoutMs}ms`),
          inactivityTimeoutMs,
        );
      }
    };

    pipeChildOutput(child, "stdout", stdout, (time) => {
      lastOutputAt = time;
      armInactivityTimer();
    }, recentOutput);
    pipeChildOutput(child, "stderr", stderr, (time) => {
      lastOutputAt = time;
      armInactivityTimer();
    }, recentOutput);

    if (runTimeoutMs > 0) {
      runTimer = setTimeoutFn(
        () => terminateForTimeout(`run exceeded ${runTimeoutMs}ms`),
        runTimeoutMs,
      );
    }
    armInactivityTimer();

    child.on("close", (code, signal) => {
      completed = true;
      clearTimers();
      if (timedOut) {
        resolve(124);
        return;
      }
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });

    child.on("error", (error) => {
      completed = true;
      clearTimers();
      reject(error);
    });
  });
}

export async function main(argv = process.argv.slice(2)) {
  const missingPaths = findMissingExplicitPaths(argv);
  if (missingPaths.length > 0) {
    console.error(`Missing test file(s): ${missingPaths.join(", ")}`);
    process.exit(1);
  }

  const runs = buildFocusedVitestRuns(argv);

  let activeChild = null;

  let exiting = false;
  const cleanup = (signal = "SIGTERM") => {
    if (exiting) {
      return;
    }
    exiting = true;
    terminateChild(activeChild, signal);
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
      const exitCode = await runFocusedVitestRun(runArgs, {
        spawnFn(command, args, spawnOptions) {
          activeChild = spawn(command, args, spawnOptions);
          return activeChild;
        },
      });
      activeChild = null;

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
