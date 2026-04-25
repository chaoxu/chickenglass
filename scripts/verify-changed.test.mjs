import { describe, expect, it } from "vitest";

import {
  buildChangedVerificationPlan,
  browserLanesForChangedFiles,
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
      "rtk pnpm test:browser:quick -- cm6-rich",
    ]);
    expect(plan.notes).toContain(
      "Browser-facing files changed; selected browser lanes: cm6-rich.",
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

  it("keeps edit profile to diff checks and focused tests", () => {
    const plan = buildChangedVerificationPlan(["scripts/verify-changed.mjs"], {
      exists: existsFrom(["scripts/verify-changed.test.mjs"]),
      profile: "edit",
    });

    expect(plan.commands.map(commandDisplay)).toEqual([
      "rtk git diff --check HEAD",
      "rtk pnpm test:focused -- scripts/verify-changed.test.mjs",
    ]);
    expect(plan.notes).toContain(
      "Edit profile skipped typecheck and architectural lints; run quick profile before push.",
    );
  });

  it("warns when edit profile cannot find a focused test for code", () => {
    const plan = buildChangedVerificationPlan(["src/no-test.ts"], {
      exists: existsFrom([]),
      profile: "edit",
    });

    expect(plan.commands.map(commandDisplay)).toEqual(["rtk git diff --check HEAD"]);
    expect(plan.notes).toContain(
      "No direct focused test was found for changed code; use quick or full profile before relying on this change.",
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

  it("adds full merge and browser suite commands in full profile", () => {
    const plan = buildChangedVerificationPlan(["src/editor/keymap.ts"], {
      profile: "full",
    });

    expect(plan.commands.map(commandDisplay)).toContain("rtk pnpm check:merge");
    expect(plan.commands.map(commandDisplay)).toContain("rtk pnpm test:browser:quick -- all");
  });

  it("does not run heavy browser harness tests for the quick-lane wrapper itself", () => {
    const plan = buildChangedVerificationPlan(["scripts/browser-lane.mjs"], {
      exists: existsFrom(["scripts/browser-lane.test.mjs"]),
    });

    expect(plan.commands.map(commandDisplay)).toContain(
      "rtk pnpm test:focused -- scripts/browser-lane.test.mjs",
    );
    expect(plan.commands.map(commandDisplay)).toContain(
      "rtk pnpm check:browser-fixtures -- scripts/browser-lane.mjs",
    );
    expect(plan.commands.map(commandDisplay)).not.toContain(
      "rtk pnpm test:focused -- scripts/test-regression.test.mjs scripts/browser-repro.test.mjs",
    );
  });

  it("guards changed browser tests against ignored local fixture dependencies", () => {
    const plan = buildChangedVerificationPlan(["scripts/regression-tests/new-case.mjs"]);

    expect(plan.commands.map(commandDisplay)).toContain(
      "rtk pnpm check:browser-fixtures -- scripts/regression-tests/new-case.mjs",
    );
  });

  it("selects browser lanes from changed paths", () => {
    expect(browserLanesForChangedFiles(["src/lexical/renderers/inline-math-renderer.tsx"])).toEqual([
      "lexical",
      "parity",
    ]);
    expect(browserLanesForChangedFiles(["src/render/image-render.ts"])).toEqual(["cm6-rich", "media"]);
    expect(browserLanesForChangedFiles(["scripts/fixture-test-helpers.mjs"])).toEqual(["smoke"]);
    expect(browserLanesForChangedFiles(["scripts/regression-tests/rich-arrowdown-bounded-scroll.mjs"])).toEqual([
      "cm6-rich",
      "scroll",
    ]);
    expect(browserLanesForChangedFiles(["docs/devx.md"])).toEqual([]);
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

  it("can collect only staged files for pre-commit checks", () => {
    const calls = [];
    const files = collectChangedFiles({
      staged: true,
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return {
          status: 0,
          stdout: "src/staged.ts\nsrc/staged.test.ts\n",
        };
      },
    });

    expect(calls).toEqual([[
      "git",
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRTUXB",
    ]]);
    expect(files).toEqual(["src/staged.test.ts", "src/staged.ts"]);
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

  it("supports --since as the base ref for collected changes", () => {
    const stdout = createStdout();
    const calls = [];
    const status = runVerifyChangedCli([
      "--since",
      "main~2",
      "--json",
    ], {
      spawnSync(command, args) {
        calls.push([command, ...args]);
        if (args.join(" ") === "diff --name-only --diff-filter=ACMRTUXB main~2...HEAD") {
          return { status: 0, stdout: "src/render/reference-render.ts\n" };
        }
        return { status: 0, stdout: "" };
      },
      stdout,
    });

    expect(status).toBe(0);
    expect(calls[0]).toEqual([
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      "main~2...HEAD",
    ]);
    expect(JSON.parse(stdout.toString()).commands.map(commandDisplay)).toContain(
      "rtk git diff --check 'main~2...HEAD'",
    );
  });

  it("supports a staged-only CLI plan", () => {
    const stdout = createStdout();
    const calls = [];
    const status = runVerifyChangedCli(["--staged"], {
      exists: existsFrom(["src/render/reference-render.test.ts"]),
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return {
          status: 0,
          stdout: args.includes("--cached") && args.includes("--name-only")
            ? "src/render/reference-render.ts\n"
            : "",
        };
      },
      stdout,
    });

    expect(status).toBe(0);
    expect(calls[0]).toEqual([
      "git",
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRTUXB",
    ]);
    expect(stdout.toString()).toContain("rtk git diff --cached --check");
    expect(stdout.toString()).not.toContain("origin/main...HEAD");
  });
});
