import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectModuleSpecifiers,
  findPluginRenderBoundaryViolations,
  findStateUpstreamBoundaryViolations,
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

  it("flags src/state imports that resolve into upstream subsystems", () => {
    const repoRoot = "/repo";
    const stateFile = path.join(repoRoot, "src", "state", "shared-field.ts");

    expect(
      findStateUpstreamBoundaryViolations(
        [
          {
            filePath: stateFile,
            sourceText: [
              'import { x } from "../editor/structure-edit-state";',
              'export { y } from "../render/render-core";',
              'import type { z } from "../plugins/plugin-types";',
              'const app = import("../app/diagnostics");',
              'import { classify } from "../index/crossref-resolver";',
            ].join("\n"),
          },
        ],
        repoRoot,
      ),
    ).toEqual([
      {
        filePath: stateFile,
        line: 1,
        specifier: "../editor/structure-edit-state",
      },
      {
        filePath: stateFile,
        line: 2,
        specifier: "../render/render-core",
      },
      {
        filePath: stateFile,
        line: 3,
        specifier: "../plugins/plugin-types",
      },
      {
        filePath: stateFile,
        line: 4,
        specifier: "../app/diagnostics",
      },
      {
        filePath: stateFile,
        line: 5,
        specifier: "../index/crossref-resolver",
      },
    ]);
  });

  it("allows src/state imports from lower-level domain modules", () => {
    const repoRoot = "/repo";

    expect(
      findStateUpstreamBoundaryViolations(
        [
          {
            filePath: path.join(repoRoot, "src", "state", "shared-field.ts"),
            sourceText: [
              'import { x } from "../semantics/document";',
              'import { y } from "../fenced-block/model";',
              'import { z } from "../lib/range-helpers";',
              'import { local } from "./document-analysis";',
            ].join("\n"),
          },
        ],
        repoRoot,
      ),
    ).toEqual([]);
  });
});
