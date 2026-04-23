import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  collectModuleSpecifiers,
  findBoundaryViolations,
  findPluginRenderBoundaryViolations,
  findSourceCycleViolations,
  findStateUpstreamBoundaryViolations,
  validateBoundaryConfig,
} from "./check-plugin-render-boundary.mjs";

const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
);

describe("import boundary checker", () => {
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

  it("flags broader neutral-layer imports and supports exact allowlists", () => {
    const repoRoot = "/repo";
    const libFile = path.join(repoRoot, "src", "lib", "model.ts");
    const entries = [
      {
        filePath: libFile,
        sourceText: [
          'import { app } from "../app/service";',
          'import { local } from "./local";',
        ].join("\n"),
      },
    ];
    const rules = [
      {
        name: "lib neutral",
        from: ["lib"],
        to: ["app"],
        allow: [],
      },
    ];

    expect(findBoundaryViolations(entries, repoRoot, rules)).toEqual([
      {
        filePath: libFile,
        line: 1,
        rule: "lib neutral",
        specifier: "../app/service",
        targetPath: null,
      },
    ]);

    expect(findBoundaryViolations(entries, repoRoot, [{
      ...rules[0],
      allow: [
        {
          file: "src/lib/model.ts",
          specifier: "../app/service",
          reason: "#1 documents the temporary owner leak",
        },
      ],
    }])).toEqual([]);
  });

  it("rejects src/lib imports from Lexical internals", () => {
    const repoRoot = "/repo";
    const libFile = path.join(repoRoot, "src", "lib", "markdown", "label-parser.ts");

    expect(
      findBoundaryViolations(
        [
          {
            filePath: libFile,
            sourceText: 'import { x } from "../../lexical/markdown/block-scanner";',
          },
        ],
        repoRoot,
        [
          {
            name: "lib neutral",
            from: ["lib"],
            to: ["lexical"],
            allow: [],
          },
        ],
      ),
    ).toEqual([
      {
        filePath: libFile,
        line: 1,
        rule: "lib neutral",
        specifier: "../../lexical/markdown/block-scanner",
        targetPath: null,
      },
    ]);
  });

  it("rejects src/render imports from app modules", () => {
    const repoRoot = "/repo";
    const renderFile = path.join(repoRoot, "src", "render", "hover-preview-media.ts");

    expect(
      findBoundaryViolations(
        [
          {
            filePath: renderFile,
            sourceText: 'import { x } from "../app/pdf-image-previews";',
          },
        ],
        repoRoot,
        [
          {
            name: "render neutral",
            from: ["render"],
            to: ["app"],
            allow: [],
          },
        ],
      ),
    ).toEqual([
      {
        filePath: renderFile,
        line: 1,
        rule: "render neutral",
        specifier: "../app/pdf-image-previews",
        targetPath: null,
      },
    ]);
  });

  it("ignores test files when enforcing production boundary rules", () => {
    const repoRoot = "/repo";

    expect(
      findBoundaryViolations(
        [
          {
            filePath: path.join(repoRoot, "src", "lib", "model.test.ts"),
            sourceText: 'import { app } from "../app/service";',
          },
        ],
        repoRoot,
        [
          {
            name: "lib neutral",
            from: ["lib"],
            to: ["app"],
            allow: [],
          },
        ],
      ),
    ).toEqual([]);
  });

  it("reports unallowlisted src import cycles", () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "coflat-boundary-"));
    const srcRoot = path.join(repoRoot, "src");
    const first = path.join(srcRoot, "first.ts");
    const second = path.join(srcRoot, "second.ts");
    mkdirSync(srcRoot, { recursive: true });
    writeFileSync(first, 'import { second } from "./second";\nexport const first = second;\n');
    writeFileSync(second, 'import { first } from "./first";\nexport const second = first;\n');

    try {
      const entries = [{ filePath: first }, { filePath: second }];
      expect(findSourceCycleViolations(entries, repoRoot)).toEqual([[
        "src/first.ts",
        "src/second.ts",
      ]]);
      expect(findSourceCycleViolations(entries, repoRoot, [
        {
          reason: "#1 tracks breaking the test cycle",
          files: ["src/first.ts", "src/second.ts"],
        },
      ])).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("requires narrow documented allowlists", () => {
    expect(validateBoundaryConfig([
      {
        name: "bad rule",
        from: ["lib"],
        to: ["app"],
        allow: [
          { file: "src/lib/", target: "src/app/*", reason: "" },
          { file: "src/lib/model.ts", reason: "#1 is missing a target" },
        ],
      },
    ], [
      {
        reason: "",
        files: ["src/a.ts"],
      },
    ])).toEqual([
      "bad rule has an allowlist entry without a reason",
      "bad rule has a broad allowlist file entry: src/lib/",
      "bad rule has a broad allowlist target entry: src/app/*",
      "bad rule allowlist entry for src/lib/model.ts needs target or specifier",
      "allowed source cycle without a reason",
      "allowed source cycle must list at least two files",
    ]);
  });
});
