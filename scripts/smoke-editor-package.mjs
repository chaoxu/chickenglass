import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITOR_BUNDLED_DEPENDENCIES,
  EDITOR_EXTERNAL_DEPENDENCIES,
  EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES,
  packageNameFromSpecifier,
} from "./editor-package-manifest.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tmpRoot = mkdtempSync(join(tmpdir(), "coflat-editor-package-"));
const consumerDir = join(tmpRoot, "consumer");
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const editorExternalDependencies = new Set(EDITOR_EXTERNAL_DEPENDENCIES);
const editorBundledDependencies = new Set(EDITOR_BUNDLED_DEPENDENCIES);
const editorForbiddenExternalDependencies = new Set(EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES);

mkdirSync(consumerDir, { recursive: true });

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function parsePackJson(output) {
  const match = output.match(/\[\s*\{[\s\S]*\}\s*\]\s*$/);
  if (!match) {
    throw new Error(`Unable to parse npm pack JSON output:\n${output}`);
  }
  return JSON.parse(match[0]);
}

function extractImportedSpecifiers(moduleSource) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(moduleSource)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers].sort();
}

function validateEditorDependencyManifest() {
  const rootDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
  const rootInstallDependencies = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  const missing = EDITOR_EXTERNAL_DEPENDENCIES.filter(
    (dependency) => !rootDependencies.has(dependency),
  );
  if (missing.length > 0) {
    throw new Error(
      `Editor dependency manifest references packages missing from dependencies: ${missing.join(", ")}`,
    );
  }

  const forbiddenAllowed = EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES.filter((dependency) =>
    editorExternalDependencies.has(dependency) || editorBundledDependencies.has(dependency),
  );
  if (forbiddenAllowed.length > 0) {
    throw new Error(
      `Editor dependency manifest allows app-only dependencies: ${forbiddenAllowed.join(", ")}`,
    );
  }

  const missingBundled = EDITOR_BUNDLED_DEPENDENCIES.filter(
    (dependency) => !rootInstallDependencies.has(dependency),
  );
  if (missingBundled.length > 0) {
    throw new Error(
      `Editor bundled dependency manifest references packages missing from dependencies/devDependencies: ${missingBundled.join(", ")}`,
    );
  }
}

function validateBuiltEditorImports(moduleSource) {
  const violations = [];

  for (const specifier of extractImportedSpecifiers(moduleSource)) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      violations.push(`relative import leaked into dist/editor.mjs: ${specifier}`);
      continue;
    }

    const packageName = packageNameFromSpecifier(specifier);
    if (!packageName) {
      continue;
    }

    if (editorForbiddenExternalDependencies.has(packageName)) {
      violations.push(`app-only dependency leaked into editor package: ${specifier}`);
      continue;
    }

    if (!editorExternalDependencies.has(packageName)) {
      violations.push(`external dependency is not in editor manifest: ${specifier}`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Invalid standalone editor dependency contract:\n${violations.join("\n")}`,
    );
  }
}

try {
  validateEditorDependencyManifest();

  const dryRunOutput = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], repoRoot);
  const [dryRunInfo] = parsePackJson(dryRunOutput);

  if (!dryRunInfo) {
    throw new Error("npm pack --dry-run did not return tarball metadata");
  }

  const packedFiles = new Set(dryRunInfo.files.map((file) => file.path));
  for (const requiredFile of ["dist/editor.mjs", "dist/editor.d.ts", "dist/editor.css"]) {
    if (!packedFiles.has(requiredFile)) {
      throw new Error(`Packed tarball is missing ${requiredFile}`);
    }
  }
  for (const requiredFont of [
    "dist/fonts/KaTeX_Main-Regular.woff2",
    "dist/fonts/KaTeX_Math-Italic.woff2",
    "dist/fonts/KaTeX_Size2-Regular.woff2",
  ]) {
    if (!packedFiles.has(requiredFont)) {
      throw new Error(`Packed tarball is missing ${requiredFont}`);
    }
  }

  const builtCss = readFileSync(join(repoRoot, "dist", "editor.css"), "utf8");
  if (!builtCss.includes("--cf-bg")) {
    throw new Error("dist/editor.css is missing theme token definitions");
  }
  if (!builtCss.includes(".cm-editor")) {
    throw new Error("dist/editor.css is missing CodeMirror overrides");
  }
  if (builtCss.includes("@import")) {
    throw new Error("dist/editor.css still contains @import directives");
  }
  if (!builtCss.includes("@font-face") || !builtCss.includes("fonts/KaTeX_Main-Regular.woff2")) {
    throw new Error("dist/editor.css is missing bundled KaTeX font-face definitions");
  }

  const builtModule = readFileSync(join(repoRoot, "dist", "editor.mjs"), "utf8");
  validateBuiltEditorImports(builtModule);
  if (builtModule.includes("@overleaf/codemirror-tree-view")) {
    throw new Error("dist/editor.mjs still externalizes @overleaf/codemirror-tree-view");
  }
  if (builtModule.includes("cf-katex-styles") || builtModule.includes("fonts/KaTeX_")) {
    throw new Error("dist/editor.mjs still injects KaTeX CSS instead of relying on editor.css");
  }

  const builtTypes = readFileSync(join(repoRoot, "dist", "editor.d.ts"), "utf8");
  if (/from ["']\.\.?\//.test(builtTypes)) {
    throw new Error("dist/editor.d.ts still contains relative imports");
  }
  if (builtTypes.includes("/src/")) {
    throw new Error("dist/editor.d.ts still references repo-internal source paths");
  }

  const packOutput = run(
    "npm",
    ["pack", "--json", "--pack-destination", tmpRoot, "--ignore-scripts"],
    repoRoot,
  );
  const [packInfo] = parsePackJson(packOutput);

  if (!packInfo) {
    throw new Error("npm pack did not return tarball metadata");
  }

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "coflat-editor-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );

  run("npm", ["install", join(tmpRoot, packInfo.filename)], consumerDir);
  run(
    "npm",
    ["install", "--save-dev", `typescript@${packageJson.devDependencies.typescript}`],
    consumerDir,
  );
  run("node", ["--input-type=module", "-e", "await import('coflat/editor');"], consumerDir);

  const installedTypesPath = join(consumerDir, "node_modules", "coflat", "dist", "editor.d.ts");
  const installedTypes = readFileSync(installedTypesPath, "utf8");

  if (/from ["']\.\.?\//.test(installedTypes)) {
    throw new Error("Packed dist/editor.d.ts still contains relative imports");
  }

  if (installedTypes.includes("/src/")) {
    throw new Error("Packed dist/editor.d.ts still references repo-internal source paths");
  }

  writeFileSync(
    join(consumerDir, "index.ts"),
    [
      "import { mountEditor } from \"coflat/editor\";",
      "",
      "const parent = document.createElement(\"div\");",
      "const editor = mountEditor({ parent, doc: \"# Hello\" });",
      "editor.setMode(\"source\");",
      "editor.setDoc(\"# Updated\");",
      "editor.unmount();",
    ].join("\n"),
  );

  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["index.ts"],
      },
      null,
      2,
    ),
  );

  run("npx", ["tsc", "--noEmit"], consumerDir);

  console.log(`editor package smoke test passed: ${join(tmpRoot, packInfo.filename)}`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
