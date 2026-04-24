import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TAURI_COMMAND_CONTRACT,
  type TauriCommandGroupContract,
} from "./command-contract";

interface ContractCommandEntry {
  readonly group: string;
  readonly name: string;
  readonly args: readonly string[];
}

const injectedRustCommandTypes = [
  "AppHandle",
  "State<",
  "WebviewWindow",
] as const;

function repoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function commandEntries(): ContractCommandEntry[] {
  const groups = TAURI_COMMAND_CONTRACT as Record<string, TauriCommandGroupContract>;
  return Object.entries(groups).flatMap(([group, commands]) =>
    Object.values(commands).map((command) => ({
      group,
      name: command.name,
      args: command.args,
    })),
  );
}

function registeredRustCommands(): Set<string> {
  const main = repoFile("src-tauri/src/main.rs");
  const handlerMatch = /generate_handler!\s*\[([\s\S]*?)\]/.exec(main);
  if (!handlerMatch) {
    throw new Error("missing tauri::generate_handler! registration");
  }

  return new Set(
    Array.from(
      handlerMatch[1].matchAll(/commands::([a-z_]+)::([a-z_]+)/g),
      (match) => `${match[1]}.${match[2]}`,
    ),
  );
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "<") angleDepth += 1;
    if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (
      char === "," &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0
    ) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = input.slice(start).trim();
  return tail ? [...parts, tail] : parts;
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("unterminated Rust function signature");
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function rustCommandArgs(source: string, commandName: string): string[] {
  const marker = `pub fn ${commandName}(`;
  const commandIndex = source.indexOf(marker);
  if (commandIndex < 0) {
    throw new Error(`missing Rust command function: ${commandName}`);
  }

  const argsStart = commandIndex + marker.length - 1;
  const argsEnd = findMatchingParen(source, argsStart);
  const argsSource = source.slice(argsStart + 1, argsEnd);

  return splitTopLevel(argsSource)
    .map((param) => {
      const separatorIndex = param.indexOf(":");
      if (separatorIndex < 0) return null;
      const name = param.slice(0, separatorIndex).trim();
      const type = param.slice(separatorIndex + 1).trim();
      if (injectedRustCommandTypes.some((injected) => type.includes(injected))) {
        return null;
      }
      return snakeToCamel(name);
    })
    .filter((name): name is string => name !== null);
}

describe("Tauri command contract", () => {
  it("matches the Rust invoke handler registration", () => {
    const registered = registeredRustCommands();
    const contractCommands = commandEntries().map(
      (entry) => `${entry.group}.${entry.name}`,
    );

    expect([...registered].sort()).toEqual([...contractCommands].sort());
  });

  it("matches Rust command argument names after Tauri camelCase mapping", () => {
    const mismatches: string[] = [];

    for (const entry of commandEntries()) {
      const source = repoFile(`src-tauri/src/commands/${entry.group}.rs`);
      const actual = rustCommandArgs(source, entry.name);
      if (actual.join(",") !== entry.args.join(",")) {
        mismatches.push(
          `${entry.group}.${entry.name}: expected [${entry.args.join(", ")}], got [${actual.join(", ")}]`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
