import process from "node:process";

const DEFAULT_VALUE_FLAGS = new Set([
  "--anchor-offset",
  "--anchor-occurrence",
  "--anchor-text",
  "--bottom-offset-px",
  "--browser",
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
  "--no-activate",
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

    if (booleanFlags.has(token)) {
      flags.set(token, true);
      continue;
    }

    const next = argv[index + 1];
    const hasValue = valueFlags.has(token)
      ? next !== undefined
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

  return {
    getFlag,
    getIntFlag,
    getPositionals,
    hasFlag,
  };
}
