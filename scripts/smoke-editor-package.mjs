import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tmpRoot = mkdtempSync(join(tmpdir(), "coflat-editor-package-"));
const consumerDir = join(tmpRoot, "consumer");
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);

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

try {
  const dryRunOutput = run("npm", ["pack", "--dry-run", "--json"], repoRoot);
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

  const builtModule = readFileSync(join(repoRoot, "dist", "editor.mjs"), "utf8");
  if (/from ["']\.\.?\//.test(builtModule) || /import\(["']\.\.?\//.test(builtModule)) {
    throw new Error("dist/editor.mjs still contains relative chunk imports");
  }
  if (builtModule.includes("@overleaf/codemirror-tree-view")) {
    throw new Error("dist/editor.mjs still externalizes @overleaf/codemirror-tree-view");
  }

  const builtTypes = readFileSync(join(repoRoot, "dist", "editor.d.ts"), "utf8");
  if (/from ["']\.\.?\//.test(builtTypes)) {
    throw new Error("dist/editor.d.ts still contains relative imports");
  }
  if (builtTypes.includes("/src/")) {
    throw new Error("dist/editor.d.ts still references repo-internal source paths");
  }

  const packOutput = run("npm", ["pack", "--json", "--pack-destination", tmpRoot], repoRoot);
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
