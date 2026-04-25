import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs = [];

function makeFakePnpm(version) {
  const dir = mkdtempSync(join(tmpdir(), "coflat-pnpm-version-test-"));
  tempDirs.push(dir);
  const bin = join(dir, "pnpm");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
  chmodSync(bin, 0o755);
  return dir;
}

describe("package manager version check", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("passes when local pnpm matches packageManager", () => {
    const pnpmDir = makeFakePnpm("10.33.0");
    const result = spawnSync(
      process.execPath,
      ["scripts/check-package-manager-version.mjs"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${pnpmDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
  });

  it("fails when local pnpm differs from packageManager", () => {
    const pnpmDir = makeFakePnpm("10.0.0");
    const result = spawnSync(
      process.execPath,
      ["scripts/check-package-manager-version.mjs"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${pnpmDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm version mismatch");
  });
});
