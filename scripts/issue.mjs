#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { splitCliCommand } from "./devx-cli.mjs";

export const DEFAULT_REPO = "chaoxu/coflat";

const COMMANDS = ["list", "view", "create", "comment", "close", "verify-close"];

function extractValueFlag(args, flag, fallback) {
  const result = [];
  let value = fallback;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      value = args[index + 1] ?? fallback;
      if (args[index + 1] !== undefined) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith(`${flag}=`)) {
      value = arg.slice(flag.length + 1);
      continue;
    }
    result.push(arg);
  }
  return { args: result, value };
}

export function buildTeaIssueArgs(argv = []) {
  const { command, options } = splitCliCommand(argv, COMMANDS, "list");
  const { args, value: repo } = extractValueFlag(options, "--repo", DEFAULT_REPO);

  switch (command) {
    case "list":
      return ["issues", "--repo", repo, ...args];
    case "view":
      return ["issues", "--repo", repo, ...args];
    case "create":
      return ["issues", "create", "--repo", repo, ...args];
    case "comment":
      return ["comment", "--repo", repo, ...args];
    case "close":
      return ["issues", "close", "--repo", repo, ...args];
    case "verify-close":
      throw new Error("verify-close is handled by the issue wrapper, not passed directly to tea.");
    default:
      throw new Error(`Unknown issue command: ${command}`);
  }
}

function extractBooleanFlag(args, flag) {
  return {
    args: args.filter((arg) => arg !== flag),
    value: args.includes(flag),
  };
}

function extractRepeatedValueFlag(args, flag) {
  const result = [];
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const next = args[index + 1];
      if (next === undefined) {
        throw new Error(`${flag} requires a value.`);
      }
      values.push(next);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
      continue;
    }
    result.push(arg);
  }
  return { args: result, values };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function command(argv, options = {}) {
  return {
    capture: Boolean(options.capture),
    display: options.display,
    kind: options.kind ?? "generic",
    argv,
  };
}

export function buildVerifiedIssueClosePlan(argv = []) {
  const { command: issueCommand, options } = splitCliCommand(argv, COMMANDS, "list");
  if (issueCommand !== "verify-close") {
    throw new Error("buildVerifiedIssueClosePlan only supports verify-close.");
  }

  let parsed = extractValueFlag(options, "--repo", DEFAULT_REPO);
  const repo = parsed.value;
  parsed = extractValueFlag(parsed.args, "--commit", "");
  const commit = parsed.value;
  const repeated = extractRepeatedValueFlag(parsed.args, "--verify");
  parsed = repeated;
  const dryRun = extractBooleanFlag(parsed.args, "--dry-run");
  parsed = dryRun;
  const allowDirty = extractBooleanFlag(parsed.args, "--allow-dirty");
  parsed = allowDirty;
  const message = extractValueFlag(parsed.args, "--message", "");
  parsed = message;

  const issues = parsed.args.filter((arg) => /^\d+$/.test(arg));
  const unknown = parsed.args.filter((arg) => !/^\d+$/.test(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown verify-close argument: ${unknown[0]}`);
  }
  if (issues.length === 0) {
    throw new Error("verify-close requires at least one issue number.");
  }
  if (!commit) {
    throw new Error("verify-close requires --commit <sha>.");
  }

  const verifyItems = unique(
    repeated.values.flatMap((value) =>
      value.split(",").map((item) => item.trim()).filter(Boolean)
    ),
  );
  if (verifyItems.length === 0) {
    throw new Error("verify-close requires at least one --verify entry.");
  }

  const body = [
    message.value || "Verification passed.",
    "",
    `Commit: ${commit}`,
    "Verified:",
    ...verifyItems.map((item) => `- ${item}`),
  ].join("\n");

  return {
    allowDirty: allowDirty.value,
    commit,
    dryRun: dryRun.value,
    issues,
    repo,
    verifyItems,
    commands: [
      command(["git", "rev-parse", "--verify", `${commit}^{commit}`], { capture: true, kind: "commit" }),
      command(["git", "status", "--short"], { capture: true, kind: "status" }),
      ...verifyItems.map((item) => command(["sh", "-lc", item], { display: item, kind: "verify" })),
      ...issues.map((issue) =>
        command(["tea", "issues", "--repo", repo, issue], { kind: "issue-view" })
      ),
      ...issues.map((issue) =>
        command(["tea", "comment", "--repo", repo, issue, body], { kind: "comment" })
      ),
      command(["tea", "issues", "close", "--repo", repo, ...issues], { kind: "close" }),
    ],
  };
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandDisplay(entry) {
  return entry.display ?? entry.argv.map(shellQuote).join(" ");
}

export function formatVerifiedIssueClosePlan(plan) {
  return [
    `Repo: ${plan.repo}`,
    `Issues: ${plan.issues.join(", ")}`,
    `Commit: ${plan.commit}`,
    `Allow dirty: ${plan.allowDirty ? "yes" : "no"}`,
    "Verification:",
    ...plan.verifyItems.map((item) => `- ${item}`),
    "",
    "Commands:",
    ...plan.commands.map((entry) => `- ${commandDisplay(entry)}`),
  ].join("\n");
}

export function runVerifiedIssueClose(argv = process.argv.slice(2), options = {}) {
  const plan = buildVerifiedIssueClosePlan(argv);
  const stdout = options.stdout ?? process.stdout;
  if (plan.dryRun) {
    stdout.write(`${formatVerifiedIssueClosePlan(plan)}\n`);
    return 0;
  }

  const spawn = options.spawnSync ?? spawnSync;
  for (const entry of plan.commands) {
    const result = spawn(entry.argv[0], entry.argv.slice(1), {
      encoding: entry.capture ? "utf8" : undefined,
      stdio: entry.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
      return result.status ?? 1;
    }
    if (entry.kind === "status" && !plan.allowDirty && String(result.stdout ?? "").trim()) {
      throw new Error("Working tree is dirty. Commit or stash changes, or pass --allow-dirty.");
    }
  }

  return 0;
}

export function printIssueHelp(stream = process.stdout) {
  stream.write(`Usage:
  pnpm issue -- list [tea options]
  pnpm issue -- view <number>
  pnpm issue -- create --title "..." --description "..."
  pnpm issue -- comment <number> "..."
  pnpm issue -- close <number>
  pnpm issue -- verify-close <number...> --commit <sha> --verify "pnpm test" [--dry-run]

All commands default to --repo ${DEFAULT_REPO}.
`);
}

export function runTeaIssue(argv = process.argv.slice(2), options = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printIssueHelp(options.stdout ?? process.stdout);
    return 0;
  }

  const { command } = splitCliCommand(argv, COMMANDS, "list");
  if (command === "verify-close") {
    return runVerifiedIssueClose(argv, options);
  }

  const tea = options.teaCommand ?? "tea";
  const teaArgs = buildTeaIssueArgs(argv);
  const result = spawnSync(tea, teaArgs, {
    stdio: "inherit",
    ...options.spawnOptions,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.exit(runTeaIssue());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
