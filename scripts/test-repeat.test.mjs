import { describe, expect, it } from "vitest";

import {
  buildRepeatRuns,
  formatRepeatRun,
  runRepeatCli,
  runRepeatRuns,
} from "./test-repeat.mjs";

function stdoutBuffer() {
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

describe("test repeat helper", () => {
  it("builds repeated focused-test runs", () => {
    expect(buildRepeatRuns(["a.test.ts", "b.test.ts"], { count: 2 })).toEqual([
      ["a.test.ts", "b.test.ts"],
      ["a.test.ts", "b.test.ts"],
    ]);
  });

  it("can shuffle each run", () => {
    expect(
      buildRepeatRuns(["a.test.ts", "b.test.ts"], {
        count: 1,
        random: () => 0,
        shuffle: true,
      }),
    ).toEqual([["b.test.ts", "a.test.ts"]]);
  });

  it("rejects missing tests and invalid counts", () => {
    expect(() => buildRepeatRuns([], { count: 1 })).toThrow(
      "test:repeat requires at least one test file.",
    );
    expect(() => buildRepeatRuns(["a.test.ts"], { count: 0 })).toThrow(
      "--count must be a positive integer.",
    );
  });

  it("formats copyable repeat commands", () => {
    expect(formatRepeatRun(["a.test.ts"], 1, 3)).toBe(
      "Repeat 2/3: pnpm test:focused -- a.test.ts",
    );
  });

  it("runs focused tests until the first failure", () => {
    const stdout = stdoutBuffer();
    const calls = [];
    const status = runRepeatRuns(
      [["a.test.ts"], ["b.test.ts"]],
      {
        pnpmCommand: "pnpm",
        spawnSync(command, args) {
          calls.push([command, ...args]);
          return { status: calls.length === 1 ? 1 : 0 };
        },
        stdout,
      },
    );

    expect(status).toBe(1);
    expect(calls).toEqual([["pnpm", "test:focused", "--", "a.test.ts"]]);
    expect(stdout.toString()).toContain("Repeat 1/2");
  });

  it("parses CLI flags and runs repeats", () => {
    const calls = [];
    const status = runRepeatCli([
      "--count",
      "2",
      "a.test.ts",
    ], {
      pnpmCommand: "pnpm",
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return { status: 0 };
      },
      stdout: stdoutBuffer(),
    });

    expect(status).toBe(0);
    expect(calls).toEqual([
      ["pnpm", "test:focused", "--", "a.test.ts"],
      ["pnpm", "test:focused", "--", "a.test.ts"],
    ]);
  });
});
