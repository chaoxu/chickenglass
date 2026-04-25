import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  buildFocusedVitestArgs,
  buildFocusedVitestRuns,
  createRecentOutputBuffer,
  findMissingExplicitPaths,
  formatCommand,
  getFocusedVitestTimeouts,
  partitionFocusedVitestArgs,
  resolvePnpmCommand,
  runFocusedVitestRun,
  terminateChild,
} from "./focused-vitest.mjs";

function createMockChild() {
  const child = new EventEmitter();
  child.pid = 1234;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    child.killedWith = signal;
  };
  return child;
}

function createMemoryStream() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
    },
    toString() {
      return value;
    },
  };
}

describe("focused vitest wrapper", () => {
  it("pins focused verification to a single deterministic worker lane", () => {
    expect(buildFocusedVitestArgs(["src/render/reference-render.test.ts"])).toEqual([
      "exec",
      "vitest",
      "run",
      "--pool",
      "forks",
      "--no-file-parallelism",
      "--maxWorkers",
      "1",
      "src/render/reference-render.test.ts",
    ]);
  });

  it("separates explicit test files from shared vitest flags", () => {
    expect(
      partitionFocusedVitestArgs([
        "--",
        "--reporter",
        "basic",
        "src/render/reference-render.test.ts",
        "src/render/hover-preview.test.ts",
      ]),
    ).toEqual({
      sharedArgs: ["--reporter", "basic"],
      explicitPaths: [
        "src/render/reference-render.test.ts",
        "src/render/hover-preview.test.ts",
      ],
      isolateFiles: false,
    });
  });

  it("runs explicit multi-file requests in one deterministic worker by default", () => {
    expect(buildFocusedVitestRuns([
      "--reporter",
      "basic",
      "src/render/reference-render.test.ts",
      "src/render/hover-preview.test.ts",
    ])).toEqual([[
      "--reporter",
      "basic",
      "src/render/reference-render.test.ts",
      "src/render/hover-preview.test.ts",
    ]]);
  });

  it("keeps one-file-per-process isolation behind an explicit flag", () => {
    expect(partitionFocusedVitestArgs([
      "--isolate-files",
      "src/render/reference-render.test.ts",
    ])).toMatchObject({
      isolateFiles: true,
      sharedArgs: [],
    });
    expect(buildFocusedVitestRuns([
      "--reporter",
      "basic",
      "--isolate-files",
      "src/render/reference-render.test.ts",
      "src/render/hover-preview.test.ts",
    ])).toEqual([
      ["--reporter", "basic", "src/render/reference-render.test.ts"],
      ["--reporter", "basic", "src/render/hover-preview.test.ts"],
    ]);
  });

  it("fails fast on missing explicit test files", () => {
    expect(
      findMissingExplicitPaths(
        ["src/render/reference-render.test.ts", "src/state/change-detection.test.ts"],
        (path) => path === "src/render/reference-render.test.ts",
      ),
    ).toEqual(["src/state/change-detection.test.ts"]);
  });

  it("spawns pnpm through the platform-specific executable", () => {
    expect(resolvePnpmCommand("darwin")).toBe("pnpm");
    expect(resolvePnpmCommand("linux")).toBe("pnpm");
    expect(resolvePnpmCommand("win32")).toBe("pnpm.cmd");
  });

  it("reads timeout overrides from environment variables", () => {
    expect(
      getFocusedVitestTimeouts({
        FOCUSED_VITEST_INACTIVITY_TIMEOUT_MS: "17",
        FOCUSED_VITEST_KILL_GRACE_MS: "23",
        FOCUSED_VITEST_TIMEOUT_MS: "31",
      }),
    ).toEqual({
      inactivityTimeoutMs: 17,
      killGraceMs: 23,
      runTimeoutMs: 31,
    });
  });

  it("keeps a bounded recent output buffer for timeout diagnostics", () => {
    const output = createRecentOutputBuffer(2);

    output.append("one\n");
    output.append("two\nthree");

    expect(output.text()).toBe("two\nthree");
  });

  it("formats commands with shell quoting for diagnostics", () => {
    expect(formatCommand(["pnpm", "exec", "vitest", "run", "src/a test.ts"])).toBe(
      "pnpm exec vitest run 'src/a test.ts'",
    );
  });

  it("falls back to defaults for invalid timeout environment values", () => {
    expect(
      getFocusedVitestTimeouts({
        FOCUSED_VITEST_INACTIVITY_TIMEOUT_MS: "nope",
        FOCUSED_VITEST_KILL_GRACE_MS: "-1",
        FOCUSED_VITEST_TIMEOUT_MS: "",
      }),
    ).toEqual({
      inactivityTimeoutMs: 120_000,
      killGraceMs: 5_000,
      runTimeoutMs: 300_000,
    });
  });

  it("uses a process-group signal on Unix so child workers are cleaned up", () => {
    const killed = [];
    const child = createMockChild();

    terminateChild(child, "SIGTERM", {
      platform: "linux",
      processKill(pid, signal) {
        killed.push({ pid, signal });
      },
    });

    expect(killed).toEqual([{ pid: -1234, signal: "SIGTERM" }]);
  });

  it("falls back to direct child kill if process-group cleanup fails", () => {
    const child = createMockChild();

    terminateChild(child, "SIGTERM", {
      platform: "linux",
      processKill() {
        throw new Error("missing process group");
      },
    });

    expect(child.killedWith).toBe("SIGTERM");
  });

  it("returns the child exit code and forwards output", async () => {
    const child = createMockChild();
    const stdout = createMemoryStream();
    const stderr = createMemoryStream();
    const spawnCalls = [];

    const run = runFocusedVitestRun(["scripts/issue.test.mjs"], {
      env: { CI: "custom" },
      spawnFn(command, args, options) {
        spawnCalls.push({ args, command, options });
        queueMicrotask(() => {
          child.stdout.emit("data", "ok\n");
          child.stderr.emit("data", "warn\n");
          child.emit("close", 0, null);
        });
        return child;
      },
      stderr,
      stdout,
      timeouts: {
        inactivityTimeoutMs: 0,
        runTimeoutMs: 0,
      },
    });

    await expect(run).resolves.toBe(0);
    expect(stdout.toString()).toBe("ok\n");
    expect(stderr.toString()).toBe("warn\n");
    expect(spawnCalls).toMatchObject([
      {
        args: buildFocusedVitestArgs(["scripts/issue.test.mjs"]),
        command: resolvePnpmCommand(),
        options: {
          env: {
            CI: "custom",
          },
          stdio: ["inherit", "pipe", "pipe"],
        },
      },
    ]);
  });

  it("terminates hung runs with exit code 124", async () => {
    const child = createMockChild();
    const stderr = createMemoryStream();
    const timers = [];
    const terminated = [];

    const run = runFocusedVitestRun(["scripts/issue.test.mjs"], {
      spawnFn() {
        return child;
      },
      stderr,
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeoutFn() {},
      terminateFn(target, signal) {
        terminated.push({ signal, target });
      },
      timeouts: {
        inactivityTimeoutMs: 0,
        killGraceMs: 0,
        runTimeoutMs: 10,
      },
    });

    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(10);
    timers[0].callback();
    child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toBe(124);
    expect(terminated).toEqual([{ signal: "SIGTERM", target: child }]);
    expect(stderr.toString()).toContain("run exceeded 10ms");
    expect(stderr.toString()).toContain("command: pnpm exec vitest run");
    expect(stderr.toString()).toContain("pid=1234");
  });

  it("terminates silent runs on the inactivity timeout", async () => {
    const child = createMockChild();
    const timers = [];
    const terminated = [];
    const stderr = createMemoryStream();
    const stdout = createMemoryStream();

    const run = runFocusedVitestRun([], {
      spawnFn() {
        return child;
      },
      stderr,
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      stdout,
      clearTimeoutFn(timer) {
        timer.cancelled = true;
      },
      terminateFn(target, signal) {
        terminated.push({ signal, target });
      },
      timeouts: {
        inactivityTimeoutMs: 20,
        killGraceMs: 0,
        runTimeoutMs: 0,
      },
    });

    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(20);
    child.stdout.emit("data", "still alive");
    expect(timers).toHaveLength(2);
    expect(timers[0].cancelled).toBe(true);
    timers[1].callback();
    child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toBe(124);
    expect(terminated).toEqual([{ signal: "SIGTERM", target: child }]);
    expect(stderr.toString()).toContain("last output:\nstill alive");
  });
});
