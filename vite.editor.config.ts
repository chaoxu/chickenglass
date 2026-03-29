import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as PackageManifest;

const dependencyNames = Object.keys(packageJson.dependencies ?? {});

function copyEditorCss(): Plugin {
  return {
    name: "copy-editor-css",
    closeBundle() {
      copyFileSync("src/editor-theme.css", "dist/editor.css");
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    copyEditorCss(),
    // Run `npm run build:analyze` to generate dist/stats.html bundle treemap
    mode === "analyze" &&
      visualizer({
        filename: "dist/stats.html",
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
  ],
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
}));
