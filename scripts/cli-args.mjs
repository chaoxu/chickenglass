import process from "node:process";

function valueFromEquals(arg, flag) {
  const prefix = `${flag}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : null;
}

export function createArgParser(argv = process.argv.slice(2)) {
  const args = [...argv];

  const getFlag = (flag, fallback = undefined) => {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      const equalsValue = valueFromEquals(arg, flag);
      if (equalsValue !== null) {
        return equalsValue;
      }
      if (arg === flag) {
        const next = args[index + 1];
        return next !== undefined && !next.startsWith("--") ? next : fallback;
      }
    }
    return fallback;
  };

  const getIntFlag = (flag, fallback) => {
    const value = getFlag(flag);
    return value !== undefined ? parseInt(value, 10) : fallback;
  };

  const hasFlag = (flag) =>
    args.some((arg) => arg === flag || valueFromEquals(arg, flag) !== null);

  const positionals = ({ valueFlags = [] } = {}) => {
    const valueFlagSet = new Set(valueFlags);
    const result = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--") {
        result.push(...args.slice(index + 1));
        break;
      }
      if (arg.startsWith("--")) {
        if (!arg.includes("=") && valueFlagSet.has(arg)) {
          index += 1;
        }
        continue;
      }
      result.push(arg);
    }
    return result;
  };

  const forwardFlags = (target, flags) => {
    for (const flag of flags) {
      const value = getFlag(flag);
      if (value !== undefined) {
        target.push(flag, value);
      }
    }
    return target;
  };

  return {
    args,
    forwardFlags,
    getFlag,
    getIntFlag,
    hasFlag,
    positionals,
  };
}

export function splitCommand(argv, commands, fallbackCommand) {
  const commandSet = new Set(commands);
  const command = commandSet.has(argv[0]) ? argv[0] : fallbackCommand;
  const options = command === argv[0] ? argv.slice(1) : argv;
  return { command, options };
}

