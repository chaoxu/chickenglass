import { describe, expect, it } from "vitest";

import {
  collectFixtureReferences,
  findIgnoredFixtureDependencies,
  runIgnoredFixtureDependencyCheck,
} from "./check-ignored-fixture-dependencies.mjs";

describe("ignored fixture dependency guard", () => {
  it("finds direct fixture path references in browser/devx files", () => {
    expect(collectFixtureReferences(`
      const path = "fixtures/private/main.md";
      const ok = "demo/index.md";
    `)).toEqual(["fixtures/private/main.md"]);
  });

  it("reports references that point at git-ignored fixture paths", () => {
    const violations = findIgnoredFixtureDependencies(
      ["scripts/regression-tests/private-case.mjs"],
      {
        isIgnored: (path) => path === "fixtures/private/main.md",
        readFile: () => 'export const fixture = "fixtures/private/main.md";',
      },
    );

    expect(violations).toEqual([{
      file: "scripts/regression-tests/private-case.mjs",
      fixturePath: "fixtures/private/main.md",
    }]);
  });

  it("exits nonzero with a clear message when ignored fixtures are referenced", () => {
    let stderr = "";
    const status = runIgnoredFixtureDependencyCheck(
      ["scripts/regression-tests/private-case.mjs"],
      {
        isIgnored: () => true,
        readFile: () => 'const fixture = "fixtures/private/main.md";',
        stderr: {
          write(chunk) {
            stderr += String(chunk);
          },
        },
      },
    );

    expect(status).toBe(1);
    expect(stderr).toContain("fixtures/private/main.md");
    expect(stderr).toContain("generated inline projects");
  });

  it("ignores the pnpm argument separator when explicit paths are passed", () => {
    const status = runIgnoredFixtureDependencyCheck(
      ["--", "scripts/regression-tests/generated-case.mjs"],
      {
        isIgnored: () => false,
        readFile: (path) => {
          expect(path).toBe("scripts/regression-tests/generated-case.mjs");
          return "export const name = 'generated-case';";
        },
      },
    );

    expect(status).toBe(0);
  });
});
