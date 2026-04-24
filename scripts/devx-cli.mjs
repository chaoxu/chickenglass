import process from "node:process";

const DEFAULT_VALUE_FLAGS = new Set([
  "--anchor-offset",
  "--anchor-occurrence",
  "--anchor-text",
  "--artifacts-dir",
  "--bottom-offset-px",
  "--browser",
  "--base",
  "--bibliography",
  "--branch",
  "--col",
  "--context-radius",
  "--direction",
  "--file",
  "--filter",
  "--fixture",
  "--label",
  "--left",
  "--limit",
  "--line",
  "--max-height-delta",
  "--max-top-delta",
  "--min-reverse-scroll-px",
  "--mode",
  "--output",
  "--pandoc",
  "--path",
  "--port",
  "--profile",
  "--radius",
  "--regression",
  "--right",
  "--scenario",
  "--session",
  "--settle-ms",
  "--start-column",
  "--start-line",
  "--step-count",
  "--step-px",
  "--steps",
  "--steps-file",
  "--steps-json",
  "--template",
  "--timeout",
  "--url",
]);

const DEFAULT_BOOLEAN_FLAGS = new Set([
  "--activate",
  "--assert-clean",
  "--expect-anomaly",
  "--headless",
  "--headed",
  "--help",
  "--json",
  "--dump-markdown",
  "--fetch",
  "--no-activate",
  "--no-link-node-modules",
  "--no-start-server",
  "--simulate-wheel",
  "-h",
]);

function isFlagLike(value) {
  return typeof value === "string" && value.startsWith("-") && !/^-?\d+$/.test(value);
}

function normalizeFlagSets(options = {}) {
  return {
    booleanFlags: new Set([
      ...DEFAULT_BOOLEAN_FLAGS,
      ...(options.booleanFlags ?? []),
    ]),
    valueFlags: new Set([
      ...DEFAULT_VALUE_FLAGS,
      ...(options.valueFlags ?? []),
    ]),
  };
}

export function parseCliArgs(argv = process.argv.slice(2), options = {}) {
  const { booleanFlags, valueFlags } = normalizeFlagSets(options);
  const flags = new Map();
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!isFlagLike(token)) {
      positionals.push(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (token.startsWith("--") && equalsIndex > 2) {
      const flagName = token.slice(0, equalsIndex);
      if (valueFlags.has(flagName)) {
        flags.set(flagName, token.slice(equalsIndex + 1));
      } else {
        flags.set(token, true);
      }
      continue;
    }

    if (booleanFlags.has(token)) {
      flags.set(token, true);
      continue;
    }

    const next = argv[index + 1];
    const hasValue = valueFlags.has(token)
      ? next !== undefined && !isFlagLike(next)
      : next !== undefined && !isFlagLike(next);
    if (hasValue) {
      flags.set(token, next);
      index += 1;
    } else {
      flags.set(token, true);
    }
  }

  return { flags, positionals };
}

export function normalizeCliArgs(args = process.argv.slice(2)) {
  return args.filter((arg) => arg !== "--");
}

export function splitCliCommand(
  argv = process.argv.slice(2),
  knownCommands = [],
  defaultCommand = undefined,
) {
  const normalized = normalizeCliArgs(argv);
  const [first, ...rest] = normalized;
  if (first && knownCommands.includes(first)) {
    return {
      command: first,
      options: rest,
      hasExplicitCommand: true,
    };
  }
  if (defaultCommand !== undefined) {
    return {
      command: defaultCommand,
      options: normalized,
      hasExplicitCommand: false,
    };
  }
  return {
    command: first,
    options: rest,
    hasExplicitCommand: false,
  };
}

/**
 * Create a small parser for script CLIs.
 *
 * Known value flags are consumed before positional arguments are collected, so
 * `--url http://localhost:5173 index.md` and `index.md --url ...` resolve the
 * same positional file.
 */
export function createArgParser(argv = process.argv.slice(2), options = {}) {
  const parsed = parseCliArgs(argv, options);
  const getFlag = (flag, fallback = undefined) => {
    const value = parsed.flags.get(flag);
    return typeof value === "string" ? value : fallback;
  };
  const getIntFlag = (flag, fallback) => {
    const value = getFlag(flag);
    if (value === undefined) {
      return fallback;
    }
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`Invalid integer value for ${flag}: ${value}`);
    }
    return Number.parseInt(value, 10);
  };
  const hasFlag = (flag) => parsed.flags.has(flag);
  const getPositionals = () => [...parsed.positionals];
  const getFlagNames = () => [...parsed.flags.keys()];
  const getRequiredFlag = (flag) => {
    const value = parsed.flags.get(flag);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    throw new Error(`${flag} requires a value.`);
  };
  const assertKnownFlags = (knownFlags) => {
    const known = new Set(knownFlags);
    const unknown = getFlagNames().filter((flag) => !known.has(flag));
    if (unknown.length > 0) {
      throw new Error(`Unknown option: ${unknown[0]}`);
    }
  };
  const getFlagRecord = ({ stripPrefix = false } = {}) => {
    const result = {};
    for (const [flag, value] of parsed.flags) {
      const key = stripPrefix ? flag.replace(/^-+/, "") : flag;
      result[key] = value;
    }
    return result;
  };

  return {
    assertKnownFlags,
    getFlag,
    getFlagNames,
    getFlagRecord,
    getIntFlag,
    getPositionals,
    getRequiredFlag,
    hasFlag,
  };
}
