/**
 * Regression test: standalone editor path must not import Tauri or
 * app-shell–specific modules at runtime.
 *
 * Scans TypeScript source files in the standalone editor directories for:
 *  1. Any import of `@tauri-apps/*` (static or dynamic)
 *  2. Dynamic `import("…/app/…")` calls — hidden runtime dependencies that
 *     break when the app shell is absent
 *
 * Type-only imports (`import type`) are allowed because TypeScript erases
 * them before bundling; they create no runtime dependency.
 *
 * Static value imports from `src/app/` utilities that are themselves
 * standalone-safe are not flagged here — those
 * are a directory-placement issue, not a coupling issue, and are tracked
 * separately for relocation.
 *
 * @see https://gitea.chaoxuprime.com/chaoxu/coflat/issues/589
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories that are part of the standalone editor path. */
const STANDALONE_DIRS = [
  "editor",
  "render",
  "plugins",
  "parser",
  "semantics",
  "lib",
  "citations",
  "index",
  "constants",
];

/** Collect all .ts/.tsx source files (excluding tests) under the given dirs. */
function collectSourceFiles(dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const dirPath = join(SRC_ROOT, dir);
    try {
      walk(dirPath, files);
    } catch (_error) {
      // Directory may not exist.
    }
  }
  // Also check top-level shared files (document-surfaces.ts, inline-surface.ts, etc.)
  try {
    for (const entry of readdirSync(SRC_ROOT)) {
      const full = join(SRC_ROOT, entry);
      if (statSync(full).isFile() && /\.tsx?$/.test(entry) && !entry.includes(".test.")) {
        files.push(full);
      }
    }
  } catch (_error) {
    // skip
  }
  return files;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push(full);
    }
  }
}

/** Match any import (static or dynamic) of @tauri-apps/. */
const TAURI_IMPORT_RE = /(?:from\s+["']@tauri-apps\/|import\(\s*["']@tauri-apps\/)/;

/** Match dynamic import("…/app/…") calls — hidden runtime coupling. */
const DYNAMIC_APP_IMPORT_RE = /import\(\s*["'](?:\.\.?\/)*app\//;

describe("standalone editor isolation", () => {
  const files = collectSourceFiles(STANDALONE_DIRS);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no standalone-path file imports @tauri-apps/ at runtime", () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip type-only imports (erased at compile time)
        if (/\bimport\s+type\b/.test(line)) continue;
        if (TAURI_IMPORT_RE.test(line)) {
          violations.push(`${relative(SRC_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      violations,
      `Standalone modules must not import @tauri-apps/ at runtime.\n` +
      `Violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("no standalone-path file dynamically imports from src/app/", () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (DYNAMIC_APP_IMPORT_RE.test(line)) {
          violations.push(`${relative(SRC_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      violations,
      `Standalone modules must not use dynamic import() from src/app/.\n` +
      `Use configurable callbacks or move the module to a shared location.\n` +
      `Violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
