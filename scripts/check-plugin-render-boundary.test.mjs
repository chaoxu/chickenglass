import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectModuleSpecifiers,
  findPluginRenderBoundaryViolations,
} from "./check-plugin-render-boundary.mjs";

const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
);

describe("plugin/render boundary checker", () => {
  it("runs from the standard lint script used by CI", () => {
    expect(packageJson.scripts.lint).toContain("pnpm lint:boundaries");
  });

  it("collects import, export, and dynamic import specifiers", () => {
    expect(
      collectModuleSpecifiers(
        [
          'import { x } from "../render/plugin-render";',
          'export { y } from "../render/render-core";',
          'const z = import("../render/code-block-render");',
        ].join("\n"),
        "/repo/src/plugins/example.ts",
      ),
    ).toEqual([
      { specifier: "../render/plugin-render", line: 1 },
      { specifier: "../render/render-core", line: 2 },
      { specifier: "../render/code-block-render", line: 3 },
    ]);
  });

  it("flags any src/plugins file that resolves into src/render", () => {
    const repoRoot = "/repo";
    const pluginFile = path.join(repoRoot, "src", "plugins", "feature.ts");

    expect(
      findPluginRenderBoundaryViolations(
        [
          {
            filePath: pluginFile,
            sourceText: [
              'import { x } from "../render/plugin-render";',
              'export { y } from "../render";',
              'const z = import("../render/index");',
            ].join("\n"),
          },
        ],
        repoRoot,
      ),
    ).toEqual([
      {
        filePath: pluginFile,
        line: 1,
        specifier: "../render/plugin-render",
      },
      {
        filePath: pluginFile,
        line: 2,
        specifier: "../render",
      },
      {
        filePath: pluginFile,
        line: 3,
        specifier: "../render/index",
      },
    ]);
  });

  it("ignores non-render imports from src/plugins", () => {
    const repoRoot = "/repo";

    expect(
      findPluginRenderBoundaryViolations(
        [
          {
            filePath: path.join(repoRoot, "src", "plugins", "feature.ts"),
            sourceText: [
              'import { x } from "../state/document-analysis";',
              'import { y } from "./plugin-render-adapter";',
              'const z = import("../constants/css-classes");',
            ].join("\n"),
          },
        ],
        repoRoot,
      ),
    ).toEqual([]);
  });
});
