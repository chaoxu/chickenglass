import { describe, expect, it } from "vitest";

import {
  buildFocusedVitestArgs,
  findMissingExplicitPaths,
  partitionFocusedVitestArgs,
} from "./focused-vitest.mjs";

describe("focused vitest wrapper", () => {
  it("pins focused verification to a single deterministic worker lane", () => {
    expect(buildFocusedVitestArgs(["src/render/reference-render.test.ts"])).toEqual([
      "exec",
      "vitest",
      "run",
      "--pool",
      "forks",
      "--no-file-parallelism",
      "--maxWorkers",
      "1",
      "src/render/reference-render.test.ts",
    ]);
  });

  it("separates explicit test files from shared vitest flags", () => {
    expect(
      partitionFocusedVitestArgs([
        "--reporter",
        "basic",
        "src/render/reference-render.test.ts",
        "src/render/hover-preview.test.ts",
      ]),
    ).toEqual({
      sharedArgs: ["--reporter", "basic"],
      explicitPaths: [
        "src/render/reference-render.test.ts",
        "src/render/hover-preview.test.ts",
      ],
    });
  });

  it("fails fast on missing explicit test files", () => {
    expect(
      findMissingExplicitPaths(
        ["src/render/reference-render.test.ts", "src/state/change-detection.test.ts"],
        (path) => path === "src/render/reference-render.test.ts",
      ),
    ).toEqual(["src/state/change-detection.test.ts"]);
  });
});
