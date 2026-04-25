import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageExport {
  readonly import?: string;
  readonly types?: string;
}

interface PackageManifest {
  readonly exports?: Record<string, PackageExport | string>;
  readonly files?: readonly string[];
  readonly name?: string;
  readonly packageManager?: string;
  readonly scripts?: Record<string, string>;
}

function readPackageJson(): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as PackageManifest;
}

describe("package editor export", () => {
  it("publishes the standalone editor from generated dist output", () => {
    const packageJson = readPackageJson();
    const editorExport = packageJson.exports?.["./editor"];

    expect(editorExport).toEqual({
      types: "./dist/editor.d.ts",
      import: "./dist/editor.mjs",
    });
    expect(packageJson.files).toContain("dist");
  });

  it("publishes the standalone editor stylesheet", () => {
    const packageJson = readPackageJson();
    const cssExport = packageJson.exports?.["./editor/style.css"];

    expect(cssExport).toBe("./dist/editor.css");
  });

  it("preserves the workflow scripts used by worktrees and push verification", () => {
    const packageJson = readPackageJson();

    expect(packageJson.name).toBe("coflat");
    expect(packageJson.packageManager).toBe("pnpm@10.33.0");
    expect(packageJson.scripts?.["dev:worktree"]).toBe("node scripts/dev-worktree.mjs");
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts?.["check:types"]).toBe("pnpm typecheck && pnpm typecheck:server");
    expect(packageJson.scripts?.["check:unit"]).toBe("node scripts/watched-vitest.mjs");
    expect(packageJson.scripts?.["check:runtime"]).toBe(
      "pnpm test:browser:quick -- smoke && pnpm test:browser:parity",
    );
    expect(packageJson.scripts?.["check:merge"]).toBe(
      "pnpm check:static && pnpm check:unit && pnpm check:runtime",
    );
    expect(packageJson.scripts?.test).toBe("pnpm check:unit");
    expect(packageJson.scripts?.prepare).toBe("lefthook install");
  });
});
