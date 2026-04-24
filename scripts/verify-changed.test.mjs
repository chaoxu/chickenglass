import { describe, expect, it } from "vitest";

import {
  buildChangedVerificationPlan,
  candidateSiblingTests,
  collectChangedFiles,
  commandDisplay,
  createPlanCommand,
  formatChangedVerificationPlan,
  runPlanCommands,
  runVerifyChangedCli,
} from "./verify-changed.mjs";

function existsFrom(paths) {
  const existing = new Set(paths);
  return (path) => existing.has(path);
}

function createStdout() {
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

describe("verify-changed", () => {
  it("finds direct sibling test candidates for code files", () => {
    expect(candidateSiblingTests("src/render/reference-render.ts")).toContain(
      "src/render/reference-render.test.ts",
    );
    expect(candidateSiblingTests("scripts/verify-changed.mjs")).toContain(
      "scripts/verify-changed.test.mjs",
    );
    expect(candidateSiblingTests("src/render/reference-render.test.ts")).toEqual([]);
  });

  it("plans focused tests and the fast static gate for code changes", () => {
    const plan = buildChangedVerificationPlan(
      ["src/render/reference-render.ts"],
      {
        diffCommands: [
          createPlanCommand(["rtk", "git", "diff", "--check", "origin/main...HEAD"]),
        ],
        exists: existsFrom(["src/render/reference-render.test.ts"]),
      },
    );

    expect(plan.commands.map(commandDisplay)).toEqual([
      "rtk git diff --check origin/main...HEAD",
      "rtk pnpm test:focused -- src/render/reference-render.test.ts",
      "rtk pnpm test:focused -- src/render/reference-render.test.ts src/render/hover-preview.test.ts src/render/hover-preview.render.test.ts",
      "rtk pnpm check:pre-push",
    ]);
    expect(plan.notes).toContain(
      "Browser-facing files changed; run `pnpm test:browser:merged-app` before closing visual/runtime issues.",
    );
  });

  it("keeps docs-only changes on a minimal quick plan", () => {
    const plan = buildChangedVerificationPlan(["docs/devx-workflow.md"], {
      diffCommands: [
        createPlanCommand(["rtk", "git", "diff", "--check", "HEAD"]),
      ],
    });

    expect(plan.commands.map(commandDisplay)).toEqual(["rtk git diff --check HEAD"]);
    expect(plan.notes).toContain(
      "Docs-only change; quick plan stays at whitespace/diff verification.",
    );
  });

  it("keeps generic package metadata out of the expensive package gate", () => {
    const plan = buildChangedVerificationPlan(["package.json"]);

    expect(plan.commands.map(commandDisplay)).toContain("rtk pnpm check:pre-push");
    expect(plan.commands.map(commandDisplay)).not.toContain("rtk pnpm check:package");
    expect(plan.notes).toContain(
      "Package metadata changed; run `pnpm check:package` if exports, editor packaging, or publish surface changed.",
    );
  });

  it("escalates editor package and Rust changes to their ownership gates", () => {
    const plan = buildChangedVerificationPlan([
      "vite.editor.config.ts",
      "src-tauri/src/main.rs",
    ]);

    expect(plan.commands.map(commandDisplay)).toContain("rtk pnpm check:pre-push");
    expect(plan.commands.map(commandDisplay)).toContain("rtk pnpm check:package");
    expect(plan.commands.map(commandDisplay)).toContain("rtk cargo nextest run");
  });

  it("adds full merge and browser smoke commands in full profile", () => {
    const plan = buildChangedVerificationPlan(["src/editor/keymap.ts"], {
      profile: "full",
    });

    expect(plan.commands.map(commandDisplay)).toContain("rtk pnpm check:merge");
    expect(plan.commands.map(commandDisplay)).toContain(
      "rtk pnpm test:browser:merged-app",
    );
  });

  it("does not run heavy browser harness tests for the quick-lane wrapper itself", () => {
    const plan = buildChangedVerificationPlan(["scripts/browser-lane.mjs"], {
      exists: existsFrom(["scripts/browser-lane.test.mjs"]),
    });

    expect(plan.commands.map(commandDisplay)).toContain(
      "rtk pnpm test:focused -- scripts/browser-lane.test.mjs",
    );
    expect(plan.commands.map(commandDisplay)).not.toContain(
      "rtk pnpm test:focused -- scripts/test-regression.test.mjs scripts/browser-repro.test.mjs",
    );
  });

  it("keeps changed file paths as argv, not shell text", () => {
    const path = "scripts/weird;touch-bad.mjs";
    const plan = buildChangedVerificationPlan([path], {
      exists: existsFrom(["scripts/weird;touch-bad.test.mjs"]),
    });

    expect(plan.commands.map(commandDisplay)).toContain(
      "rtk pnpm test:focused -- 'scripts/weird;touch-bad.test.mjs'",
    );
    expect(plan.commands.find((command) =>
      command.argv.includes("scripts/weird;touch-bad.test.mjs")
    )?.argv).toContain("scripts/weird;touch-bad.test.mjs");
  });

  it("collects committed, unstaged, staged, and untracked files from git", () => {
    const calls = [];
    const outputs = new Map([
      ["diff --name-only --diff-filter=ACMRTUXB origin/main...HEAD", "src/a.ts\n"],
      ["diff --name-only --diff-filter=ACMRTUXB", "src/b.ts\n"],
      ["diff --cached --name-only --diff-filter=ACMRTUXB", "src/c.ts\n"],
      ["ls-files --others --exclude-standard", "src/a.ts\nsrc/d.ts\n"],
    ]);

    const files = collectChangedFiles({
      base: "origin/main",
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return {
          status: 0,
          stdout: outputs.get(args.join(" ")) ?? "",
        };
      },
    });

    expect(calls).toHaveLength(4);
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
  });

  it("formats plans for copyable command execution", () => {
    expect(
      formatChangedVerificationPlan({
        commands: [createPlanCommand(["rtk", "pnpm", "check:pre-push"])],
        files: ["src/a.ts"],
        notes: ["Run browser smoke."],
        profile: "quick",
      }),
    ).toBe([
      "Changed files: 1",
      "- src/a.ts",
      "",
      "Verification plan (quick):",
      "- rtk pnpm check:pre-push",
      "",
      "Notes:",
      "- Run browser smoke.",
    ].join("\n"));
  });

  it("runs commands until the first failure", () => {
    const calls = [];
    const status = runPlanCommands(
      [
        createPlanCommand(["rtk", "pnpm", "check:pre-push"]),
        createPlanCommand(["rtk", "pnpm", "check:merge"]),
      ],
      {
        spawnSync(command, args) {
          calls.push([command, ...args]);
          return { status: calls.length === 1 ? 1 : 0 };
        },
      },
    );

    expect(status).toBe(1);
    expect(calls).toEqual([["rtk", "pnpm", "check:pre-push"]]);
  });

  it("prints and executes the CLI plan for explicit files", () => {
    const stdout = createStdout();
    const calls = [];
    const status = runVerifyChangedCli([
      "--run",
      "scripts/verify-changed.mjs",
    ], {
      exists: existsFrom(["scripts/verify-changed.test.mjs"]),
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return { status: 0 };
      },
      stdout,
    });

    expect(status).toBe(0);
    expect(stdout.toString()).toContain("scripts/verify-changed.mjs");
    expect(calls).toEqual([
      ["rtk", "git", "diff", "--check", "origin/main...HEAD"],
      ["rtk", "git", "diff", "--check", "HEAD"],
      ["rtk", "pnpm", "test:focused", "--", "scripts/verify-changed.test.mjs"],
      ["rtk", "pnpm", "check:pre-push"],
    ]);
  });
});
