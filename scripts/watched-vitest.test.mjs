import { describe, expect, it } from "vitest";

import {
  buildWatchedVitestArgs,
  runWatchedVitestCli,
} from "./watched-vitest.mjs";

describe("watched vitest wrapper", () => {
  it("keeps full-suite Vitest parallelism while adding the shared watchdog", () => {
    expect(buildWatchedVitestArgs(["--changed"])).toEqual([
      "exec",
      "vitest",
      "run",
      "--changed",
    ]);
  });

  it("runs through the shared watchdog with parallel Vitest defaults", async () => {
    const child = {
      pid: 1234,
      stdout: {
        on(event, callback) {
          if (event === "data") {
            queueMicrotask(() => callback("ok\n"));
          }
        },
      },
      stderr: {
        on() {},
      },
      on(event, callback) {
        if (event === "close") {
          queueMicrotask(() => callback(0, null));
        }
      },
      kill() {},
    };
    const spawnCalls = [];

    await expect(runWatchedVitestCli(["--changed"], {
      spawnFn(command, args) {
        spawnCalls.push({ args, command });
        return child;
      },
      stdout: { write() {} },
      stderr: { write() {} },
      timeouts: {
        inactivityTimeoutMs: 0,
        runTimeoutMs: 0,
      },
    })).resolves.toBe(0);

    expect(spawnCalls).toMatchObject([
      {
        args: ["exec", "vitest", "run", "--changed"],
        command: "pnpm",
      },
    ]);
  });
});
