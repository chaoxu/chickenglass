import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function repoFileExists(relativePath: string): boolean {
  return existsSync(resolve(ROOT, relativePath));
}

describe("React migration tombstones", () => {
  it("keeps obsolete pre-React app entry files deleted", () => {
    expect(repoFileExists("src/main.ts")).toBe(false);
    expect(repoFileExists("src/app/app.ts")).toBe(false);
    expect(repoFileExists("src/app/app-keybindings.ts")).toBe(false);
    expect(repoFileExists("src/app/app-export.ts")).toBe(false);
    expect(repoFileExists("src/app/status-bar.ts")).toBe(false);
    expect(repoFileExists("src/app/settings.ts")).toBe(false);
  });

  it("keeps the React app entry points and shared engine modules present", () => {
    expect(repoFileExists("src/app/main.tsx")).toBe(true);
    expect(repoFileExists("src/app/app.tsx")).toBe(true);
    expect(repoFileExists("src/editor/editor.ts")).toBe(true);
    expect(repoFileExists("src/editor/theme.ts")).toBe(true);
    expect(repoFileExists("src/parser/fenced-div.ts")).toBe(true);
    expect(repoFileExists("src/plugins/plugin-registry.ts")).toBe(true);
    expect(repoFileExists("src/render/math-render.ts")).toBe(true);
    expect(repoFileExists("src/citations/bibtex-parser.ts")).toBe(true);
    expect(repoFileExists("src/index/indexer.ts")).toBe(true);
  });
});
