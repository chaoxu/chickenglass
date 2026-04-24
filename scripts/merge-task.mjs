#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createArgParser, normalizeCliArgs } from "./devx-cli.mjs";

const VALUE_FLAGS = [
  "--base",
  "--base-branch",
  "--base-ref",
  "--branch",
  "--check",
  "--handoff",
  "--issue",
  "--old-base",
];
const BOOLEAN_FLAGS = ["--help", "-h", "--run"];

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function inferRemoteFromRef(ref) {
  const slashIndex = ref.indexOf("/");
  return slashIndex > 0 ? ref.slice(0, slashIndex) : "origin";
}

export function collectRepeatedValueFlag(argv, flag) {
  const rest = [];
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === flag) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${flag} requires a value.`);
      }
      values.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
      continue;
    }
    rest.push(arg);
  }

  return { rest, values };
}

function readHandoff(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("handoff JSON must be an object.");
  }
  return parsed;
}

function stringField(source, key) {
  const value = source[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function stringArrayField(source, key) {
  if (source[key] === undefined) {
    return [];
  }
  if (!Array.isArray(source[key]) || !source[key].every((value) => typeof value === "string")) {
    throw new Error(`handoff field ${key} must be an array of strings.`);
  }
  return source[key];
}

export function normalizeMergeTaskHandoff(handoff = {}) {
  return {
    baseBranch: stringField(handoff, "baseBranch"),
    baseRef: stringField(handoff, "baseRef") ?? stringField(handoff, "base"),
    branch: stringField(handoff, "branch"),
    checks: stringArrayField(handoff, "checks"),
    issue: stringField(handoff, "issue"),
    oldBase: stringField(handoff, "oldBase"),
  };
}

export function buildMergeTaskSteps({
  baseBranch = "main",
  baseRef = `origin/${baseBranch}`,
  branch,
  checks = [],
  issue,
  oldBase,
} = {}) {
  if (!branch) {
    throw new Error("--branch is required.");
  }

  const fetchRemote = inferRemoteFromRef(baseRef);
  const steps = [
    {
      command: ["rtk", "git", "fetch", fetchRemote],
      label: "Fetch base",
    },
    {
      command: ["rtk", "git", "cherry", "-v", baseRef, branch],
      label: "Inspect duplicate or patch-equivalent commits",
    },
    {
      command: ["rtk", "git", "switch", branch],
      label: "Switch task branch",
    },
    oldBase
      ? {
        command: ["rtk", "git", "rebase", "--onto", baseRef, oldBase, branch],
        label: "Replay branch onto base",
      }
      : {
        command: ["rtk", "git", "rebase", baseRef],
        label: "Rebase branch onto base",
      },
    {
      command: ["rtk", "git", "diff", "--stat", `${baseRef}...HEAD`],
      label: "Review branch diff",
    },
  ];

  for (const check of checks) {
    if (!check.startsWith("rtk ")) {
      throw new Error("--check must be an rtk-prefixed repo-root command.");
    }
    steps.push({
      label: "Run verification",
      shell: check,
    });
  }

  steps.push(
    {
      command: ["rtk", "git", "switch", baseBranch],
      label: "Manual after verification: switch base branch",
      manual: true,
    },
    {
      command: ["rtk", "git", "merge", "--ff-only", baseRef],
      label: "Manual after verification: update base branch",
      manual: true,
    },
    {
      command: ["rtk", "git", "merge", "--ff-only", branch],
      label: "Manual after verification: fast-forward merge",
      manual: true,
    },
    {
      command: ["rtk", "git", "push", "origin", baseBranch],
      label: "Manual after verification: push base",
      manual: true,
    },
  );

  if (issue) {
    if (checks.length === 0) {
      steps.push({
        label: "Issue close blocked",
        note: `Add at least one --check before closing #${issue}.`,
      });
    } else {
      steps.push({
        command: ["rtk", "pnpm", "issue", "--", "close", issue],
        label: "Manual after merge verification: close issue",
        manual: true,
      });
    }
  }

  return steps;
}

export function formatMergeTaskSteps(steps) {
  return steps
    .map((step, index) => {
      if (step.note) {
        return `${index + 1}. ${step.label}\n   ${step.note}`;
      }
      const command = step.shell ?? step.command.map(shellQuote).join(" ");
      const prefix = step.manual ? "[manual] " : "";
      return `${index + 1}. ${prefix}${step.label}\n   ${command}`;
    })
    .join("\n");
}

export function parseMergeTaskArgs(argv = process.argv.slice(2)) {
  const { rest, values: checks } = collectRepeatedValueFlag(
    normalizeCliArgs(argv),
    "--check",
  );
  const parser = createArgParser(rest, {
    booleanFlags: BOOLEAN_FLAGS,
    valueFlags: VALUE_FLAGS,
  });
  parser.assertKnownFlags([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);
  const handoff = parser.hasFlag("--handoff")
    ? normalizeMergeTaskHandoff(readHandoff(parser.getRequiredFlag("--handoff")))
    : {};

  const cliBaseBranch = parser.getFlag("--base-branch");
  const cliBaseAlias = parser.getFlag("--base");
  const baseBranch = cliBaseBranch ?? cliBaseAlias ?? handoff.baseBranch ?? "main";
  const hasCliBaseBranch = cliBaseBranch !== undefined || cliBaseAlias !== undefined;
  const cliBaseRef = parser.getFlag("--base-ref");

  return {
    baseBranch,
    baseRef: cliBaseRef ?? (hasCliBaseBranch ? undefined : handoff.baseRef) ?? `origin/${baseBranch}`,
    branch: parser.getFlag("--branch", handoff.branch),
    checks: checks.length > 0 ? checks : handoff.checks ?? [],
    issue: parser.getFlag("--issue", handoff.issue),
    oldBase: parser.getFlag("--old-base", handoff.oldBase),
    run: parser.hasFlag("--run"),
  };
}

export function runMergeTaskSteps(steps, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  for (const step of steps) {
    if (step.manual || step.note) {
      continue;
    }
    const result = step.shell
      ? spawn(step.shell, {
        shell: true,
        stdio: "inherit",
      })
      : spawn(step.command[0], step.command.slice(1), {
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

export function printMergeTaskHelp(stream = process.stdout) {
  stream.write(`Usage:
  pnpm merge-task -- --branch <worker-branch> [--base-branch main] [--base-ref origin/main] [--old-base <ref>]
  pnpm merge-task -- --branch <worker-branch> --issue 1234 --check "rtk pnpm test:focused -- file.test.ts"
  pnpm merge-task -- --handoff /tmp/coflat-agent-handoff.json
  pnpm merge-task -- --branch <worker-branch> --run

The helper prints rtk-prefixed fetch/duplicate-inspection/rebase/diff/check
steps plus manual merge/push/close steps by default. Use --run only after
reviewing the plan; --run executes only non-manual steps.
--base remains as a shorthand alias for --base-branch.
Handoff JSON accepts issue, branch, baseBranch, baseRef, oldBase, and checks.
`);
}

export function runMergeTaskCli(argv = process.argv.slice(2), options = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printMergeTaskHelp(options.stdout ?? process.stdout);
    return 0;
  }

  const parsed = parseMergeTaskArgs(argv);
  const steps = buildMergeTaskSteps(parsed);
  const stdout = options.stdout ?? process.stdout;
  if (parsed.issue) {
    stdout.write(`Issue: #${parsed.issue}\n`);
  }
  stdout.write(`${formatMergeTaskSteps(steps)}\n`);
  if (!parsed.run) {
    return 0;
  }
  return runMergeTaskSteps(steps, options);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(runMergeTaskCli());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
