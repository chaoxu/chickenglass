import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  TAURI_COMMANDS,
  TAURI_EVENT_CHANNELS,
  TAURI_FILE_CHANGED_EVENT_FIELDS,
  TAURI_MENU_IDS,
} from "./bridge-metadata";

/**
 * Single-source-of-truth enforcement for the Tauri ↔ TS bridge.
 *
 * Ground truth lives in the Rust source:
 *   - Menu IDs: src-tauri/src/menu.rs — every `MenuItemBuilder::with_id("…")`
 *   - Command names: src-tauri/src/main.rs — the `generate_handler!` list
 *
 * This test parses those files and asserts that the TS constants in
 * bridge-metadata.ts mirror them exactly. Any drift fails CI, preventing the
 * two sides of the bridge from silently diverging (issues #163, #164).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

function extractMenuIdsFromRust(source: string): string[] {
  const re = /MenuItemBuilder::with_id\(\s*"([^"]+)"/g;
  const ids: string[] = [];
  for (const match of source.matchAll(re)) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
}

function extractCommandsFromRust(source: string): string[] {
  const handlerMatch = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  if (!handlerMatch || !handlerMatch[1]) {
    throw new Error("Could not find tauri::generate_handler![...] in main.rs");
  }
  const body = handlerMatch[1];
  const commands: string[] = [];
  for (const raw of body.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Paths look like "commands::fs::read_file" — take the final segment.
    const parts = trimmed.split("::");
    const last = parts[parts.length - 1];
    if (last) commands.push(last);
  }
  return commands;
}

function extractEventChannelsFromRust(...sources: string[]): string[] {
  const channels = new Set<string>();
  const re = /\.emit_to\([^,]+,\s*"([^"]+)"/g;
  for (const source of sources) {
    for (const match of source.matchAll(re)) {
      if (match[1]) channels.add(match[1]);
    }
  }
  return [...channels].sort();
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function extractFileChangedEventFieldsFromRust(source: string): string[] {
  const structMatch = /struct\s+FileChangedEvent\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!structMatch?.[1]) {
    throw new Error("Could not find FileChangedEvent struct in watch.rs");
  }
  const re = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
  const fields: string[] = [];
  for (const match of structMatch[1].matchAll(re)) {
    if (match[1]) fields.push(snakeToCamel(match[1]));
  }
  return fields.sort();
}

function extractDebugFileChangedFieldsFromRust(source: string): string[] {
  const commandMatch = /pub fn debug_emit_file_changed[\s\S]*?json!\(\{([\s\S]*?)\}\)/.exec(source);
  if (!commandMatch?.[1]) {
    throw new Error("Could not find debug_emit_file_changed JSON payload in debug.rs");
  }
  const fields: string[] = [];
  for (const match of commandMatch[1].matchAll(/"([^"]+)"\s*:/g)) {
    if (match[1]) fields.push(match[1]);
  }
  return fields.sort();
}

describe("bridge-metadata sync with Rust backend", () => {
  it("TAURI_MENU_IDS values match every MenuItemBuilder::with_id in menu.rs", () => {
    const menuRs = readRepoFile("src-tauri/src/menu.rs");
    const rustIds = extractMenuIdsFromRust(menuRs).sort();
    const tsIds = Object.values(TAURI_MENU_IDS).sort();
    expect(tsIds).toEqual(rustIds);
  });

  it("TAURI_COMMANDS values match every name in generate_handler! in main.rs", () => {
    const mainRs = readRepoFile("src-tauri/src/main.rs");
    const rustCommands = extractCommandsFromRust(mainRs).sort();
    const tsCommands = Object.values(TAURI_COMMANDS).sort();
    expect(tsCommands).toEqual(rustCommands);
  });

  it("TAURI_EVENT_CHANNELS values match native event emitters", () => {
    const rustChannels = extractEventChannelsFromRust(
      readRepoFile("src-tauri/src/menu.rs"),
      readRepoFile("src-tauri/src/services/watch.rs"),
      readRepoFile("src-tauri/src/commands/debug.rs"),
    );
    const tsChannels = Object.values(TAURI_EVENT_CHANNELS).sort();
    expect(tsChannels).toEqual(rustChannels);
  });

  it("file-changed payload fields match Rust serde camelCase output", () => {
    const watchRs = readRepoFile("src-tauri/src/services/watch.rs");
    const debugRs = readRepoFile("src-tauri/src/commands/debug.rs");
    const rustWatcherFields = extractFileChangedEventFieldsFromRust(watchRs);
    const debugFields = extractDebugFileChangedFieldsFromRust(debugRs);
    const tsFields = [...TAURI_FILE_CHANGED_EVENT_FIELDS].sort();

    expect(tsFields).toEqual(rustWatcherFields);
    expect(debugFields).toEqual(rustWatcherFields);
  });
});
