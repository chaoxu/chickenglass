import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageExport {
  readonly import?: string;
  readonly types?: string;
}

interface PackageManifest {
  readonly exports?: Record<string, PackageExport>;
  readonly files?: readonly string[];
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
});
