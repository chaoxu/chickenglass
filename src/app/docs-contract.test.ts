import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function repoFileExists(relativePath: string): boolean {
  return existsSync(resolve(ROOT, relativePath));
}

describe("repository documentation contracts", () => {
  it("points agent instructions at FORMAT.md as the canonical markdown spec", () => {
    for (const instructionFile of ["AGENTS.md", "CLAUDE.md"]) {
      const text = readRepoFile(instructionFile);

      expect(text).toContain("FORMAT.md");
      expect(text).toContain("All markdown files in this repo must follow `FORMAT.md`.");
    }
  });

  it("documents the subsystem pattern and neutral state owner rule", () => {
    const subsystemPattern = readRepoFile("docs/architecture/subsystem-pattern.md");

    expect(repoFileExists("docs/architecture/subsystem-pattern.md")).toBe(true);
    expect(subsystemPattern).toContain("## Neutral owner for cross-subsystem state");
    expect(subsystemPattern).toContain("`src/state/` is the");
    expect(subsystemPattern).toContain("subsystems may consume `src/state/`");
    expect(subsystemPattern).toContain("must not define state for another subsystem");
    expect(subsystemPattern).toContain("`src/state/document-analysis.ts`");
    expect(subsystemPattern).toContain("`src/state/code-block-structure.ts`");
    expect(subsystemPattern).toContain("`src/state/plugin-registry.ts`");
  });

  it("documents document-state and theme-token ownership", () => {
    const documentState = readRepoFile("docs/architecture/document-state-module.md");
    const themeContract = readRepoFile("docs/architecture/theme-contract.md");

    expect(documentState).toContain("Do not add a broad `src/state/index.ts` barrel");
    expect(documentState).toContain("src/state/<use-case>-state.ts");
    expect(themeContract).toContain("Canonical token names live in `src/theme-contract.ts`");
    expect(themeContract).toContain("themeSurfaceTokenMap");
  });
});
