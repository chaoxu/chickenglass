import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function extractRustStructFields(source: string, structName: string): string[] {
  const structMatch = new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!structMatch?.[1]) {
    throw new Error(`Could not find Rust struct ${structName}`);
  }
  const fields: string[] = [];
  for (const match of structMatch[1].matchAll(/^\s*pub\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) {
    if (match[1]) fields.push(snakeToCamel(match[1]));
  }
  for (const match of structMatch[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) {
    if (match[1] && !fields.includes(snakeToCamel(match[1]))) {
      fields.push(snakeToCamel(match[1]));
    }
  }
  return fields.sort();
}

function extractTsInterfaceFields(source: string, interfaceName: string): string[] {
  const interfaceMatch = new RegExp(`interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!interfaceMatch?.[1]) {
    throw new Error(`Could not find TypeScript interface ${interfaceName}`);
  }
  const fields: string[] = [];
  for (const match of interfaceMatch[1].matchAll(/^\s*(?:readonly\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/gm)) {
    if (match[1]) fields.push(match[1]);
  }
  return fields.sort();
}

function extractRustStructFieldContracts(
  source: string,
  structName: string,
): Array<{ name: string; optional: boolean }> {
  const structMatch = new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!structMatch?.[1]) {
    throw new Error(`Could not find Rust struct ${structName}`);
  }
  const fields: Array<{ name: string; optional: boolean }> = [];
  for (const match of structMatch[1].matchAll(/^\s*(?:pub\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^,\n]+)/gm)) {
    if (match[1] && match[2]) {
      fields.push({
        name: snakeToCamel(match[1]),
        optional: /\bOption\s*</.test(match[2]),
      });
    }
  }
  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

function extractTsInterfaceFieldContracts(
  source: string,
  interfaceName: string,
): Array<{ name: string; optional: boolean }> {
  const interfaceMatch = new RegExp(`interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!interfaceMatch?.[1]) {
    throw new Error(`Could not find TypeScript interface ${interfaceName}`);
  }
  const fields: Array<{ name: string; optional: boolean }> = [];
  for (const match of interfaceMatch[1].matchAll(/^\s*(?:readonly\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:/gm)) {
    if (match[1]) {
      fields.push({
        name: match[1],
        optional: match[2] === "?",
      });
    }
  }
  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

function extractRustAppErrorCodes(source: string): string[] {
  return [...source.matchAll(/Self::(?:new|with_details)\(\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((code): code is string => Boolean(code))
    .sort();
}

function extractTsNativeCommandErrorCodes(source: string): string[] {
  const match = source.match(/NATIVE_COMMAND_ERROR_CODES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match?.[1]) {
    throw new Error("Could not find NATIVE_COMMAND_ERROR_CODES");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((codeMatch) => codeMatch[1])
    .filter((code): code is string => Boolean(code))
    .sort();
}

describe("native DTO contracts", () => {
  it("FileEntry fields match Rust serde camelCase output", () => {
    const rustFields = extractRustStructFields(
      readRepoFile("src-tauri/src/services/filesystem.rs"),
      "FileEntry",
    );
    const tsFields = extractTsInterfaceFields(readRepoFile("src/lib/types.ts"), "FileEntry");

    expect(tsFields).toEqual(rustFields);
  });

  it("FileChangedEvent fields match Rust serde camelCase output", () => {
    const rustFields = extractRustStructFields(
      readRepoFile("src-tauri/src/services/watch.rs"),
      "FileChangedEvent",
    );
    const tsFields = extractTsInterfaceFields(readRepoFile("src/app/file-watcher.ts"), "FileChangedEvent");

    expect(tsFields).toEqual(rustFields);
  });

  it("FileChangedEvent required fields match Rust serde output", () => {
    const rustFields = extractRustStructFieldContracts(
      readRepoFile("src-tauri/src/services/watch.rs"),
      "FileChangedEvent",
    );
    const tsFields = extractTsInterfaceFieldContracts(
      readRepoFile("src/app/file-watcher.ts"),
      "FileChangedEvent",
    );

    expect(tsFields).toEqual(rustFields);
  });

  it("NativeDebugState fields match Rust serde camelCase output", () => {
    const rustFields = extractRustStructFields(
      readRepoFile("src-tauri/src/commands/debug.rs"),
      "NativeDebugState",
    );
    const tsFields = extractTsInterfaceFields(readRepoFile("src/app/tauri-client/debug.ts"), "NativeDebugState");

    expect(tsFields).toEqual(rustFields);
  });

  it("NativeCommandError fields match Rust AppError serde output", () => {
    const rustFields = extractRustStructFields(
      readRepoFile("src-tauri/src/commands/error.rs"),
      "AppError",
    );
    const tsFields = extractTsInterfaceFields(readRepoFile("src/app/tauri-client/core.ts"), "NativeCommandError");

    expect(tsFields).toEqual(rustFields);
  });

  it("NativeCommandError codes match Rust AppError constructors", () => {
    const rustCodes = extractRustAppErrorCodes(readRepoFile("src-tauri/src/commands/error.rs"));
    const tsCodes = extractTsNativeCommandErrorCodes(readRepoFile("src/app/tauri-client/core.ts"));

    expect(tsCodes).toEqual(rustCodes);
  });
});
