import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as PackageManifest;

const dependencyNames = Object.keys(packageJson.dependencies ?? {});

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./editor.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "editor.mjs",
    },
    rollupOptions: {
      external: (id) =>
        !id.includes("?inline") &&
        !id.endsWith(".css") &&
        dependencyNames.some((dependency) =>
          id === dependency || id.startsWith(`${dependency}/`),
        ),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
